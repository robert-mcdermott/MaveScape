package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// "mavescape mcp" is a Model Context Protocol server for AI agents (wave 7, slice 1; requirement
// M4). It starts MaveScape as usual, with remote control on, and answers the agent's JSON-RPC
// requests on stdin and stdout, one message per line. Its tools are the remote-control actions
// (actions.go), each performed by the open MaveScape page (web/ui/remote.js) as a script's are,
// under the agent's name, which the workspace's history records with each change. The banner and
// logs go to stderr, since stdout carries the protocol; when the agent closes stdin, MaveScape
// stops. The window opens when a tool first needs it. Ported from CytoWeave 0.8.0's mcp.go
// (itself from Proteoscope's MCP server); the tools and instructions are MaveScape's.

var mcpProtocolVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}

const (
	mcpMaxLine      = 64 << 20
	mcpTextLimit    = 200_000
	mcpImageLimit   = 8 << 20
	mcpPageWait     = 40 * time.Second
	mcpReopenAfter  = 20 * time.Second
	mcpProgressTick = 5 * time.Second
	mcpEndGrace     = time.Second
	mcpInstructions = "MaveScape analyzes multiplexed assays of variant effect (deep mutational scans) in a window on this computer, which the user watches: count or score tables, the experiment's design, functional scores with standard errors, quality control, the variant-effect map, comparisons, protein structures, figures and a record a reviewer can check. Start with get_state. Open data with open_example (bundled experiments, and MaveDB records), open_files (absolute paths of count or score tables, FASTA or GenBank targets, designs, workspace archives .msz, structures) or open_mavedb (a score set's URN; search_mavedb finds one). Say what each column of the counts is with draft_design or set_design (check checks a table, design and parameters without scoring), then score: each scoring makes a new, immutable run. Read qc_findings before trusting the scores. Read results with inspect_variant (a variant's evidence), render_map (the map in words), select_variants (by name, position or a query such as \"missense at 40-80 with se < 0.2\"), compare (two runs, replicates or conditions, a MaveDB score set or a predictor such as AlphaMissense, on one scale) and check_robustness (whether a variant's conclusion survives other reasonable analysis choices). Structures: find_structures, open_structure, map_structure, set_structure (color by the scores), structure_evidence. Calibration, for research: make_control_set (variants of known effect from ClinVar, after add_track clinvar, or from a table of labels, each label as its source gives it) and control_sets (their composition, what a run measured of them, and what may make them circular); calibrate (a run's scores against a control set when asked: the separation of the sides with intervals, thresholds and the functional classes they make) and calibrations. The record: create_figure and add_figure_panel, report (the methods of the whole workspace, with references), checkpoint and diff (what changed since), certify and verify_certificate; export, export_figure, certify and review_report write files to absolute paths in folders that exist, never replacing a file unless overwrite is given. Scores are research evidence of a variant's functional effect in this assay, never a clinical classification: do not call a variant pathogenic or benign. Every change appears in the window, can be undone there, and is recorded in the workspace's history with your name. Your changes are proposals the user accepts or rejects in the window: what you make (a run, a selection, a figure or a panel, a track, a saved view, an analysis kept in the report, a checkpoint) is made at once, marked proposed, and you can use it meanwhile; the design, QC thresholds and acknowledgements, a target's check, the MaveDB details and every removal wait until the user accepts them (score waits for a design you proposed). proposals says what is open and what was decided. Nothing is certified while a proposal is open; exports are not proposals."
)

type mcpMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpServer struct {
	hub      *remoteHub
	url      string
	out      io.Writer
	outMu    sync.Mutex
	pageWait time.Duration
	// progressTick: how often a long call reports progress (mcpProgressTick when zero).
	progressTick time.Duration
	calls        sync.WaitGroup
	openPage     func()
	cancelMu     sync.Mutex
	cancels      map[string]context.CancelFunc
	clientMu     sync.Mutex
	client       string
}

func runMCP(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	log.SetOutput(stderr)
	cfg, err := parseConfig(args)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		return 2
	}
	if cfg.showVersion {
		fmt.Fprintf(stdout, "mavescape %s\n", version)
		return 0
	}
	if !isLoopbackName(normalizeHost(cfg.host)) {
		fmt.Fprintln(stderr, "mavescape mcp serves only this computer; leave out --host or use --host 127.0.0.1.")
		return 2
	}
	cfg.remote, cfg.mcp = true, true
	window := cfg.window
	cfg.window = "none"
	running, err := start(cfg, stderr)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	served := make(chan error, 1)
	go func() { served <- running.serve() }()
	server := &mcpServer{hub: running.app.control, url: running.url, out: stdout, pageWait: mcpPageWait}
	if window != "none" {
		var mu sync.Mutex
		var last time.Time
		server.openPage = func() {
			mu.Lock()
			defer mu.Unlock()
			if time.Since(last) < mcpReopenAfter {
				return
			}
			last = time.Now()
			if _, err := openWindow(running.url, window, cfg.dataDir); err != nil {
				log.Printf("open window: %v", err)
			}
		}
	}
	err = server.serveStream(context.Background(), stdin)
	running.stop(2 * time.Second)
	if err != nil {
		fmt.Fprintln(stderr, "MCP:", err)
		return 1
	}
	if err := <-served; err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

// serveStream reads one JSON-RPC message per line until the input ends. Tool calls run
// concurrently; the page still performs them one at a time.
func (s *mcpServer) serveStream(ctx context.Context, in io.Reader) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	reader := bufio.NewReaderSize(in, 1<<20)
	var readErr error
	for {
		line, err := readLine(reader, mcpMaxLine)
		if errors.Is(err, errLineTooLong) {
			s.send(json.RawMessage("null"), nil, &mcpError{Code: -32700, Message: "Parse error: the message is longer than 64 MiB"})
			continue
		}
		if len(strings.TrimSpace(string(line))) > 0 {
			s.receive(ctx, line)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				readErr = err
			}
			break
		}
	}
	grace := time.AfterFunc(mcpEndGrace, cancel)
	s.calls.Wait()
	grace.Stop()
	return readErr
}

var errLineTooLong = errors.New("line too long")

func readLine(reader *bufio.Reader, limit int) ([]byte, error) {
	var line []byte
	tooLong := false
	for {
		chunk, err := reader.ReadSlice('\n')
		if !tooLong {
			if len(line)+len(chunk) > limit {
				tooLong, line = true, nil
			} else {
				line = append(line, chunk...)
			}
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if tooLong && err == nil {
			return nil, errLineTooLong
		}
		return []byte(strings.TrimRight(string(line), "\r\n")), err
	}
}

func (s *mcpServer) receive(ctx context.Context, line []byte) {
	trimmed := strings.TrimSpace(string(line))
	if !strings.HasPrefix(trimmed, "{") {
		code, message := -32600, "Invalid Request: send one JSON-RPC object per line (batches are not supported)"
		if !json.Valid(line) {
			code, message = -32700, "Parse error"
		}
		s.send(json.RawMessage("null"), nil, &mcpError{Code: code, Message: message})
		return
	}
	var message mcpMessage
	if err := json.Unmarshal(line, &message); err != nil {
		s.send(json.RawMessage("null"), nil, &mcpError{Code: -32700, Message: "Parse error"})
		return
	}
	hasID := len(message.ID) > 0 && string(message.ID) != "null"
	if message.Method == "" {
		if hasID && (len(message.Result) > 0 || len(message.Error) > 0) {
			return
		}
		s.send(idOrNull(message.ID), nil, &mcpError{Code: -32600, Message: "Invalid Request"})
		return
	}
	if message.JSONRPC != "2.0" {
		if hasID {
			s.send(message.ID, nil, &mcpError{Code: -32600, Message: "Invalid Request: jsonrpc must be \"2.0\""})
		}
		return
	}
	if message.Method == "tools/call" && hasID {
		callCtx, cancel := context.WithCancel(ctx)
		key := string(message.ID)
		s.cancelMu.Lock()
		if s.cancels == nil {
			s.cancels = map[string]context.CancelFunc{}
		}
		s.cancels[key] = cancel
		s.cancelMu.Unlock()
		s.calls.Add(1)
		go func() {
			defer s.calls.Done()
			defer func() {
				s.cancelMu.Lock()
				delete(s.cancels, key)
				s.cancelMu.Unlock()
				cancel()
			}()
			s.handle(callCtx, message)
		}()
		return
	}
	s.handle(ctx, message)
}

func idOrNull(id json.RawMessage) json.RawMessage {
	if len(id) == 0 {
		return json.RawMessage("null")
	}
	return id
}

func (s *mcpServer) handle(ctx context.Context, request mcpMessage) {
	notification := len(request.ID) == 0 || string(request.ID) == "null"
	var result any
	var failure *mcpError
	switch request.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
			ClientInfo      struct {
				Name  string `json:"name"`
				Title string `json:"title"`
			} `json:"clientInfo"`
		}
		json.Unmarshal(request.Params, &params)
		s.clientMu.Lock()
		s.client = clientName(params.ClientInfo.Title, clientName(params.ClientInfo.Name, ""))
		s.clientMu.Unlock()
		result = map[string]any{
			"protocolVersion": negotiateVersion(params.ProtocolVersion),
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "mavescape", "title": "MaveScape", "version": version},
			"instructions":    mcpInstructions,
		}
	case "ping":
		result = map[string]any{}
	case "tools/list":
		result = map[string]any{"tools": remoteActions}
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
			Meta      struct {
				ProgressToken json.RawMessage `json:"progressToken"`
			} `json:"_meta"`
		}
		if err := json.Unmarshal(request.Params, &params); err != nil {
			failure = &mcpError{Code: -32602, Message: "Invalid params"}
			break
		}
		action, ok := findAction(params.Name)
		if !ok {
			failure = &mcpError{Code: -32602, Message: fmt.Sprintf("Unknown tool: %s", params.Name)}
			break
		}
		stop := s.reportProgress(params.Meta.ProgressToken)
		result = s.callTool(ctx, action, params.Arguments)
		stop()
		if ctx.Err() != nil {
			return
		}
	case "notifications/cancelled":
		var params struct {
			RequestID json.RawMessage `json:"requestId"`
		}
		json.Unmarshal(request.Params, &params)
		s.cancelMu.Lock()
		cancel := s.cancels[string(params.RequestID)]
		s.cancelMu.Unlock()
		if cancel != nil {
			cancel()
		}
		return
	default:
		if strings.HasPrefix(request.Method, "notifications/") {
			return
		}
		failure = &mcpError{Code: -32601, Message: fmt.Sprintf("Method not found: %s", request.Method)}
	}
	if notification {
		return
	}
	s.send(request.ID, result, failure)
}

// reportProgress sends a progress notification every few seconds while a call with a progress
// token runs (scoring, a robustness check or a certificate can take minutes). The function it
// returns stops them and waits until the last one is written, so that none follows the call's
// reply (MCP: progress ends with the request).
func (s *mcpServer) reportProgress(token json.RawMessage) func() {
	if len(token) == 0 || string(token) == "null" {
		return func() {}
	}
	done := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		tick := s.progressTick
		if tick <= 0 {
			tick = mcpProgressTick
		}
		ticker := time.NewTicker(tick)
		defer ticker.Stop()
		for step := 1; ; step++ {
			select {
			case <-done:
				return
			case <-ticker.C:
				// A tick and the end can come together: the end wins.
				select {
				case <-done:
					return
				default:
				}
				s.notify("notifications/progress", map[string]any{"progressToken": token, "progress": step, "message": "MaveScape is working in the window"})
			}
		}
	}()
	return func() {
		close(done)
		<-finished
	}
}

func negotiateVersion(requested string) string {
	for _, supported := range mcpProtocolVersions {
		if requested == supported {
			return requested
		}
	}
	return mcpProtocolVersions[0]
}

func (s *mcpServer) send(id json.RawMessage, result any, failure *mcpError) {
	message := map[string]any{"jsonrpc": "2.0", "id": id}
	if failure != nil {
		message["error"] = failure
	} else {
		message["result"] = result
	}
	s.write(message, id)
}

func (s *mcpServer) notify(method string, params any) {
	s.write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params}, nil)
}

func (s *mcpServer) write(message map[string]any, id json.RawMessage) {
	data, err := json.Marshal(message)
	if err != nil {
		data, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": idOrNull(id), "error": mcpError{Code: -32603, Message: err.Error()}})
	}
	s.outMu.Lock()
	defer s.outMu.Unlock()
	s.out.Write(append(data, '\n'))
}

// callTool checks the arguments, waits for a page (opening the window), prepares the files the
// action reads or writes (the agent on stdio is the person's, as a script with the token is),
// sends it to the page under the agent's name and shapes the reply.
func (s *mcpServer) callTool(ctx context.Context, action remoteAction, raw json.RawMessage) map[string]any {
	var args map[string]any
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return toolError("The arguments are not a JSON object.")
		}
	}
	if args == nil {
		args = map[string]any{}
	}
	required, _ := action.InputSchema["required"].([]string)
	for _, name := range required {
		if value, ok := args[name]; !ok || value == nil || value == "" {
			return toolError(fmt.Sprintf("%s is required.", name))
		}
	}
	if s.hub.latest() == nil && s.openPage != nil {
		s.openPage()
	}
	if !s.hub.waitForPage(ctx, s.pageWait) {
		return toolError(fmt.Sprintf("No MaveScape page is connected. Open %s in a browser, then try again.", s.url))
	}
	encoded, _ := json.Marshal(args)
	s.clientMu.Lock()
	client := clientName(s.client, "an AI agent")
	s.clientMu.Unlock()
	event, release, err := s.hub.prepare(remoteEvent{Action: action.Name, Args: encoded, Client: client, Agent: true}, action)
	if err != nil {
		return toolError(err.Error())
	}
	defer release()
	outcome, err := s.hub.dispatch(ctx, event)
	if err != nil {
		return toolError(err.Error())
	}
	return commandResult(outcome)
}

func toolError(message string) map[string]any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": message}}, "isError": true}
}

// commandResult: the page's sentence and its data, as text (the data's JSON after the sentence,
// cut at mcpTextLimit) and as structured content (all of it, as the page wrote it: its fields in
// their order, its numbers exactly), and its pictures as images (extractImages).
func commandResult(outcome remoteResult) map[string]any {
	if !outcome.OK {
		return toolError(outcome.Message)
	}
	text := outcome.Message
	structured := map[string]any{"message": outcome.Message}
	var images []mcpImage
	if len(outcome.Data) > 0 && string(outcome.Data) != "null" {
		if json.Valid(outcome.Data) {
			data, found, dropped := extractImages(outcome.Data)
			images = found
			structured["data"] = data
			serialized := string(data)
			if len(serialized) > mcpTextLimit {
				serialized = strings.ToValidUTF8(serialized[:mcpTextLimit], "") + " … (truncated; the structured content has everything)"
			}
			if text != "" {
				text += "\n\n"
			}
			text += serialized
			if dropped > 0 {
				text += fmt.Sprintf("\n\n%d more image%s left out (null above): the images of one result are limited to %d MB in all.", dropped, map[bool]string{true: "", false: "s"}[dropped == 1], mcpImageLimit>>20)
			}
		}
	}
	if text == "" {
		text = "Done."
	}
	content := []any{map[string]any{"type": "text", "text": text}}
	for index, image := range images {
		content = append(content,
			map[string]any{"type": "text", "text": fmt.Sprintf("Image %d: %s", index+1, image.caption)},
			map[string]any{"type": "image", "data": image.data, "mimeType": image.mimeType})
	}
	return map[string]any{"content": content, "structuredContent": structured}
}

// Pictures in a result (wave 7, slice 3; after CytoWeave's): the page gives each as a data URL in
// its data (render_map, render_structure, figures with image), with a caption beside it. An agent
// gets each as MCP image content, after the text, and the data names it by its number (1, 2, …),
// its fields kept in the page's order; past mcpImageLimit of them in all, null. A script reads the
// data URLs as they are.
type mcpImage struct {
	data, mimeType, caption string
}

var dataURLImage = regexp.MustCompile(`"data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)"`)

func extractImages(raw json.RawMessage) (json.RawMessage, []mcpImage, int) {
	if !bytes.Contains(raw, []byte(`"data:image/`)) {
		return raw, nil, 0
	}
	captions := map[string]string{}
	var decoded any
	if json.Unmarshal(raw, &decoded) == nil {
		collectCaptions(decoded, captions)
	}
	var images []mcpImage
	dropped, total := 0, 0
	out := dataURLImage.ReplaceAllFunc(raw, func(match []byte) []byte {
		parts := dataURLImage.FindSubmatch(match)
		data := string(parts[2])
		if total+len(data) > mcpImageLimit {
			dropped++
			return []byte("null")
		}
		total += len(data)
		caption := captions[data]
		if caption == "" {
			caption = "image"
		}
		images = append(images, mcpImage{data: data, mimeType: string(parts[1]), caption: caption})
		return []byte(strconv.Itoa(len(images)))
	})
	return out, images, dropped
}

// collectCaptions finds each data URL's caption: its object's caption, title or name.
func collectCaptions(value any, captions map[string]string) {
	switch typed := value.(type) {
	case map[string]any:
		caption := ""
		for _, key := range []string{"caption", "title", "name"} {
			if text, ok := typed[key].(string); ok && text != "" {
				caption = text
				break
			}
		}
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.HasPrefix(text, "data:image/") {
				if _, data, found := strings.Cut(text, ";base64,"); found {
					captions[data] = caption
				}
				continue
			}
			collectCaptions(item, captions)
		}
	case []any:
		for _, item := range typed {
			collectCaptions(item, captions)
		}
	}
}
