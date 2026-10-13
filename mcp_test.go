package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// The MCP server (mcp.go): JSON-RPC on stdio, its tools the remote actions, each call performed by
// the page under the agent's name. After CytoWeave 0.8.0's mcp_test.go.

func runLines(t *testing.T, server *mcpServer, lines ...string) []map[string]any {
	t.Helper()
	var out bytes.Buffer
	server.out = &out
	if err := server.serveStream(context.Background(), strings.NewReader(strings.Join(lines, "\n")+"\n")); err != nil {
		t.Fatal(err)
	}
	var replies []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		if line == "" {
			continue
		}
		var reply map[string]any
		if err := json.Unmarshal([]byte(line), &reply); err != nil {
			t.Fatalf("bad reply %q: %v", line, err)
		}
		replies = append(replies, reply)
	}
	return replies
}

func byID(replies []map[string]any) map[float64]map[string]any {
	out := map[float64]map[string]any{}
	for _, reply := range replies {
		if id, ok := reply["id"].(float64); ok {
			out[id] = reply
		}
	}
	return out
}

func textOf(t *testing.T, result map[string]any) string {
	t.Helper()
	return result["content"].([]any)[0].(map[string]any)["text"].(string)
}

func TestMCPInitializeAndListTools(t *testing.T) {
	server := &mcpServer{hub: newRemoteHub(), pageWait: 50 * time.Millisecond}
	replies := runLines(t, server,
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"test"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"nope"}`,
		`not json`,
		`{"jsonrpc":"2.0","id":4,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`,
		`{"jsonrpc":"2.0","id":5,"method":"ping"}`,
	)
	if len(replies) != 6 {
		t.Fatalf("got %d replies: %v", len(replies), replies)
	}
	init := replies[0]["result"].(map[string]any)
	if init["protocolVersion"] != "2025-06-18" || init["serverInfo"].(map[string]any)["name"] != "mavescape" || !strings.Contains(init["instructions"].(string), "get_state") {
		t.Fatalf("initialize: %v", init)
	}
	// The tools are the remote actions, in their order, each with a title, its schema and hints.
	tools := replies[1]["result"].(map[string]any)["tools"].([]any)
	if len(tools) != len(remoteActions) {
		t.Fatalf("%d tools, %d actions", len(tools), len(remoteActions))
	}
	for index, raw := range tools {
		tool := raw.(map[string]any)
		if tool["name"] != remoteActions[index].Name || tool["title"] == "" || tool["inputSchema"] == nil || tool["description"] == "" {
			t.Fatalf("tool %d: %v", index, tool)
		}
		hints := tool["annotations"].(map[string]any)
		if _, ok := hints["readOnlyHint"].(bool); !ok {
			t.Fatalf("tool %s: no readOnlyHint in %v", tool["name"], hints)
		}
	}
	if replies[2]["error"].(map[string]any)["code"].(float64) != -32601 {
		t.Fatalf("unknown method: %v", replies[2])
	}
	if replies[3]["error"].(map[string]any)["code"].(float64) != -32700 {
		t.Fatalf("parse error: %v", replies[3])
	}
	// A protocol version not offered: the latest offered.
	if replies[4]["result"].(map[string]any)["protocolVersion"] != mcpProtocolVersions[0] {
		t.Fatalf("version: %v", replies[4])
	}
	if len(replies[5]["result"].(map[string]any)) != 0 {
		t.Fatalf("ping: %v", replies[5])
	}
}

func TestEveryActionHasATitleAndHints(t *testing.T) {
	seen := map[string]bool{}
	for _, action := range remoteActions {
		hint, ok := actionHints[action.Name]
		if !ok || hint.title == "" {
			t.Errorf("action %s has no title in actionHints", action.Name)
			continue
		}
		switch hint.kind {
		case "read", "edit", "file":
		default:
			t.Errorf("action %s: kind %q is not read, edit or file", action.Name, hint.kind)
		}
		if hint.kind == "file" && !action.output {
			t.Errorf("action %s writes a file but is not an output action", action.Name)
		}
		if action.output && hint.kind != "file" {
			t.Errorf("action %s is an output action; its kind is file, not %s", action.Name, hint.kind)
		}
		if hint.kind == "read" && hint.destructive {
			t.Errorf("action %s reads only but is marked destructive", action.Name)
		}
		seen[action.Name] = true
	}
	var stale []string
	for name := range actionHints {
		if !seen[name] {
			stale = append(stale, name)
		}
	}
	sort.Strings(stale)
	if len(stale) > 0 {
		t.Errorf("actionHints names actions that do not exist: %v", stale)
	}
}

func TestMCPToolCallsReachThePageUnderTheAgentsName(t *testing.T) {
	hub := newRemoteHub()
	var seen remoteEvent
	stop := fakePage(t, hub, func(event remoteEvent) remoteResult {
		seen = event
		return remoteResult{OK: true, Message: "GRB2 SH3: 1 table, 1 score run", Data: json.RawMessage(`{"runs":[{"name":"Run 1"}]}`)}
	})
	defer stop()
	server := &mcpServer{hub: hub, pageWait: time.Second}
	replies := runLines(t, server, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect_variant","arguments":{"variant":"p.Trp36Ala"}}}`)
	result := replies[0]["result"].(map[string]any)
	if seen.Action != "inspect_variant" || !seen.Agent || seen.Client != "an AI agent" {
		t.Fatalf("page saw %+v", seen)
	}
	var args map[string]any
	json.Unmarshal(seen.Args, &args)
	if args["variant"] != "p.Trp36Ala" {
		t.Fatalf("arguments not passed: %s", seen.Args)
	}
	text := textOf(t, result)
	if !strings.Contains(text, "1 score run") || !strings.Contains(text, `"name":"Run 1"`) {
		t.Fatalf("text %q", text)
	}
	if result["structuredContent"].(map[string]any)["message"] != "GRB2 SH3: 1 table, 1 score run" {
		t.Fatalf("structured %v", result["structuredContent"])
	}
	// The agent's name, as its client gives it (printable, its title before its name).
	runLines(t, server,
		`{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"claude-code","title":"Claude Code\u0007"}}}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_state","arguments":{}}}`,
	)
	if seen.Client != "Claude Code" || !seen.Agent {
		t.Fatalf("client %q, agent %v", seen.Client, seen.Agent)
	}
	runLines(t, server,
		`{"jsonrpc":"2.0","id":4,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"codex"}}}`,
		`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_state"}}`,
	)
	if seen.Client != "codex" {
		t.Fatalf("client %q", seen.Client)
	}
}

func TestMCPRequiredArgumentsMissingPageAndUnknownTools(t *testing.T) {
	server := &mcpServer{hub: newRemoteHub(), pageWait: 20 * time.Millisecond, url: "http://127.0.0.1:8820"}
	replies := byID(runLines(t, server,
		`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect_variant","arguments":{}}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_state","arguments":{}}}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"unknown_tool"}}`,
		`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_state","arguments":[1,2]}}`,
	))
	first := replies[1]["result"].(map[string]any)
	if first["isError"] != true || textOf(t, first) != "variant is required." {
		t.Fatalf("missing argument: %v", first)
	}
	second := replies[2]["result"].(map[string]any)
	if second["isError"] != true || !strings.Contains(textOf(t, second), "No MaveScape page is connected. Open http://127.0.0.1:8820") {
		t.Fatalf("no page: %v", second)
	}
	if replies[3]["error"] == nil || !strings.Contains(replies[3]["error"].(map[string]any)["message"].(string), "unknown_tool") {
		t.Fatalf("unknown tool: %v", replies[3])
	}
	if fourth := replies[4]["result"].(map[string]any); fourth["isError"] != true || !strings.Contains(textOf(t, fourth), "not a JSON object") {
		t.Fatalf("arguments not an object: %v", replies[4])
	}
}

func TestMCPPageRefusalsBecomeToolErrors(t *testing.T) {
	hub := newRemoteHub()
	stop := fakePage(t, hub, func(remoteEvent) remoteResult {
		return remoteResult{OK: false, Message: `p.Trp999Ala is not in Run 1.`}
	})
	defer stop()
	server := &mcpServer{hub: hub, pageWait: time.Second}
	replies := runLines(t, server, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect_variant","arguments":{"variant":"p.Trp999Ala"}}}`)
	result := replies[0]["result"].(map[string]any)
	if result["isError"] != true || textOf(t, result) != "p.Trp999Ala is not in Run 1." {
		t.Fatalf("%v", result)
	}
}

// Pictures (wave 7, slice 3): each data URL in a result's data becomes an image after the text,
// captioned, the data naming it by its number with its fields in the page's order; past the limit,
// null and said.
func TestMCPPicturesBecomeImageContent(t *testing.T) {
	hub := newRemoteHub()
	png := "iVBORw0KGgo="
	stop := fakePage(t, hub, func(remoteEvent) remoteResult {
		return remoteResult{OK: true, Message: "The map.", Data: json.RawMessage(`{"run":"Run 1","caption":"The map of Run 1","image":"data:image/png;base64,` + png + `","pages":[{"name":"Figure 1","image":"data:image/png;base64,AAAA"}]}`)}
	})
	defer stop()
	server := &mcpServer{hub: hub, pageWait: time.Second}
	replies := runLines(t, server, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"render_map","arguments":{"image":true}}}`)
	result := replies[0]["result"].(map[string]any)
	content := result["content"].([]any)
	if len(content) != 5 {
		t.Fatalf("content: %v", content)
	}
	if text := content[0].(map[string]any)["text"].(string); text != `The map.`+"\n\n"+`{"run":"Run 1","caption":"The map of Run 1","image":1,"pages":[{"name":"Figure 1","image":2}]}` {
		t.Fatalf("text: %s", text)
	}
	first, second := content[2].(map[string]any), content[4].(map[string]any)
	if content[1].(map[string]any)["text"] != "Image 1: The map of Run 1" || first["type"] != "image" || first["data"] != png || first["mimeType"] != "image/png" || content[3].(map[string]any)["text"] != "Image 2: Figure 1" || second["data"] != "AAAA" {
		t.Fatalf("images: %v", content[1:])
	}
	data, _ := json.Marshal(result["structuredContent"].(map[string]any)["data"])
	if !strings.Contains(string(data), `"image":1`) || strings.Contains(string(data), "base64") {
		t.Fatalf("structured: %s", data)
	}

	big := strings.Repeat("A", mcpImageLimit/2+4)
	out, images, dropped := extractImages(json.RawMessage(`{"a":"data:image/png;base64,` + big + `","b":"data:image/png;base64,` + big + `"}`))
	if len(images) != 1 || dropped != 1 || string(out) != `{"a":1,"b":null}` {
		t.Fatalf("limit: %d images, %d dropped, %.40s", len(images), dropped, out)
	}
}

// An agent writes and reads files by path, as a script with the token does: an export gets an
// upload slot for its path, checked first; files to open are registered for the page.
func TestMCPFilesByPath(t *testing.T) {
	hub := newRemoteHub()
	dir := t.TempDir()
	table := filepath.Join(dir, "counts.csv")
	os.WriteFile(table, []byte("hgvs_pro,input,output\np.Ala2Val,10,20\n"), 0o600)
	hub.open = func(paths []string) ([]localFile, []string) {
		var files []localFile
		for _, path := range paths {
			if _, err := os.Stat(path); err == nil {
				files = append(files, localFile{Name: filepath.Base(path)})
			}
		}
		if len(files) == 0 {
			return nil, []string{"no such file"}
		}
		return files, nil
	}
	var seen []remoteEvent
	stop := fakePage(t, hub, func(event remoteEvent) remoteResult {
		seen = append(seen, event)
		return remoteResult{OK: true, Message: "done"}
	})
	defer stop()
	server := &mcpServer{hub: hub, pageWait: time.Second}
	target := filepath.Join(dir, "scores.csv")
	replies := byID(runLines(t, server,
		`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"export","arguments":{"what":"scores","path":`+jsonString(target)+`}}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"export","arguments":{"what":"scores","path":"relative/scores.csv"}}}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"open_files","arguments":{"paths":[`+jsonString(table)+`]}}}`,
		`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"open_files","arguments":{"paths":[`+jsonString(filepath.Join(dir, "missing.csv"))+`]}}}`,
	))
	// The calls run at once; the page sees them in either order.
	events := map[string]remoteEvent{}
	for _, event := range seen {
		events[event.Action] = event
	}
	if len(seen) != 2 || events["export"].Output == "" || len(events["open_files"].Files) != 1 || events["open_files"].Files[0].Name != "counts.csv" {
		t.Fatalf("the page saw %+v", seen)
	}
	if r := replies[2]["result"].(map[string]any); r["isError"] != true || !strings.Contains(textOf(t, r), "is not an absolute path") {
		t.Fatalf("relative path: %v", r)
	}
	if r := replies[4]["result"].(map[string]any); r["isError"] != true || !strings.Contains(textOf(t, r), "no such file") {
		t.Fatalf("missing file: %v", r)
	}
}

// ioPipe: what the test writes, the server reads, a line at a time.
type pipeWriter struct{ *io.PipeWriter }

func (w pipeWriter) WriteString(s string) { w.Write([]byte(s)) }

func ioPipe() (*io.PipeReader, pipeWriter) {
	reader, writer := io.Pipe()
	return reader, pipeWriter{writer}
}

func jsonString(s string) string {
	data, _ := json.Marshal(s)
	return string(data)
}

// A call the agent cancels gets no reply; one with a progress token hears from the server while it
// runs.
func TestMCPCancellationAndProgress(t *testing.T) {
	hub := newRemoteHub()
	release := make(chan struct{})
	stop := fakePage(t, hub, func(event remoteEvent) remoteResult {
		if event.Action == "check_robustness" {
			<-release
		} else {
			time.Sleep(120 * time.Millisecond)
		}
		return remoteResult{OK: true, Message: event.Action}
	})
	defer stop()
	server := &mcpServer{hub: hub, pageWait: time.Second, progressTick: 20 * time.Millisecond}
	reader, writer := ioPipe()
	var out bytes.Buffer
	server.out = &out
	done := make(chan error, 1)
	go func() { done <- server.serveStream(context.Background(), reader) }()
	writer.WriteString(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_robustness","arguments":{}}}` + "\n")
	time.Sleep(50 * time.Millisecond)
	writer.WriteString(`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1,"reason":"no longer needed"}}` + "\n")
	time.Sleep(50 * time.Millisecond)
	// The page finishes what it was doing, as the window does; its answer goes nowhere.
	close(release)
	writer.WriteString(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_state","arguments":{},"_meta":{"progressToken":"p2"}}}` + "\n")
	time.Sleep(400 * time.Millisecond)
	writer.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	text := out.String()
	if strings.Contains(text, `"id":1`) {
		t.Fatalf("a cancelled call was answered: %s", text)
	}
	if !strings.Contains(text, `"id":2`) || !strings.Contains(text, `"method":"notifications/progress"`) || !strings.Contains(text, `"progressToken":"p2"`) {
		t.Fatalf("no answer or no progress: %s", text)
	}
	// Progress ends with the call: none after its reply.
	if strings.LastIndex(text, `"progressToken":"p2"`) > strings.Index(text, `"id":2`) {
		t.Fatalf("progress after the reply: %s", text)
	}
}

// The real command: the protocol alone on stdout, the banner on stderr; it stops when stdin ends.
func TestMCPCommandKeepsStdoutForTheProtocol(t *testing.T) {
	stdin := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}` + "\n" + `{"jsonrpc":"2.0","id":2,"method":"tools/list"}` + "\n")
	var stdout, stderr bytes.Buffer
	code := runMCP([]string{"--window", "none", "--port", "0", "--data-dir", t.TempDir(), "--no-fetch"}, stdin, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	lines := strings.Split(strings.TrimSpace(stdout.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("stdout has %d lines: %q", len(lines), stdout.String())
	}
	for _, line := range lines {
		var message map[string]any
		if err := json.Unmarshal([]byte(line), &message); err != nil || message["jsonrpc"] != "2.0" {
			t.Fatalf("not JSON-RPC on stdout: %q", line)
		}
	}
	if !strings.Contains(stderr.String(), "MaveScape "+version+" is running at") || !strings.Contains(stderr.String(), "MCP: answering on stdin and stdout") {
		t.Fatalf("banner: %s", stderr.String())
	}
	if code := runMCP([]string{"--host", "0.0.0.0"}, strings.NewReader(""), &stdout, &stderr); code != 2 {
		t.Fatalf("a host other than this computer: exit %d", code)
	}
}

// docs/MCP.md names every tool, so its table stays the list.
func TestTheMCPGuideNamesEveryTool(t *testing.T) {
	guide, err := os.ReadFile("docs/MCP.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range remoteActions {
		if !strings.Contains(string(guide), "`"+action.Name+"`") {
			t.Errorf("docs/MCP.md does not name the tool %s", action.Name)
		}
	}
}

// open_example names every example (web/lib/examples.js), so an agent and the clients' help know
// their ids.
func TestOpenExampleNamesEveryExample(t *testing.T) {
	source, err := os.ReadFile("web/lib/examples.js")
	if err != nil {
		t.Fatal(err)
	}
	var description string
	for _, action := range remoteActions {
		if action.Name == "open_example" {
			description = action.InputSchema["properties"].(map[string]any)["id"].(map[string]any)["description"].(string)
		}
	}
	ids := regexp.MustCompile(`(?m)^    id: '([^']+)',$`).FindAllStringSubmatch(string(source), -1)
	if len(ids) < 10 {
		t.Fatalf("found %d examples in web/lib/examples.js", len(ids))
	}
	for _, id := range ids {
		if !strings.Contains(description, `"`+id[1]+`"`) {
			t.Errorf("open_example's description does not name the example %s", id[1])
		}
	}
}
