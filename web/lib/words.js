// Words about names, shared by the views and the libraries.

// A name's possessive: "Run 1's", "Published scores'" (not "Published scores's").
export const possessive = (name) => (/s$/.test(name) ? `${name}'` : `${name}'s`);
