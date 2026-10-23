/**
 * Sample App declarations for the workbench desktop: in-file copies of the
 * Inkcap, Prints and Grove manifests, so Tourtois depends on no sibling App
 * package. The real App-set rendering proof is Bonsai test:app-set.
 */
export const inkcapApp = {
  displayName: "Inkcap",
  icon: "inkcap",
  capabilities: [
    "agent.list",
    "agent.manage",
    "agent.read",
    "agent.send",
    "computer.list",
    "computer.readFile",
    "computer.writeFile",
    "app.storage",
    "apps.call",
  ],
  calls: [
    {
      appId: "app_bonsai",
      methods: [
        "files.tree",
        "files.list",
        "files.read",
        "commits.list",
        "rebuildCopies",
        "files.save",
        "files.sync",
        "files.discard",
      ],
    },
  ],
  handlers: ["file.open"],
  roles: ["files"],
  commands: [
    {
      id: "new-draft",
      title: "New Draft",
      category: "File",
      description: "Create a new draft in Inkcap",
      sigil: "inkcap",
      projections: {
        bindings: { values: ["<leader>n"], order: 0 },
        menu: { order: 0 },
        palette: { order: 0 },
      },
    },
    {
      id: "save",
      title: "Save",
      category: "File",
      description: "Save the focused Inkcap document",
      projections: {
        bindings: { values: ["mod+s"], order: 1 },
        menu: { order: 1 },
        palette: { order: 1 },
      },
    },
    {
      id: "open-file",
      title: "Open File",
      category: "File",
      description: "Open a file handed off by another App",
      projections: { menu: { order: 2 } },
    },
  ],
  storage: [{ key: "documents-recent", scopes: ["member"], maxBytes: 2048 }],
  backend: {
    bindings: [
      { name: "APP_STORAGE", operations: ["read", "write"] },
      { name: "COMPUTER", operations: ["list", "read", "write"] },
    ],
  },
} as const;
export const printsApp = {
  displayName: "Prints",
  icon: "prints",
  capabilities: [
    "computer.list",
    "computer.readFile",
    "computer.writeFile",
    "media.generation",
  ],
  handlers: [],
  roles: ["media"],
  commands: [
    {
      id: "clear-prompt",
      title: "Clear prompt",
      category: "Prompt",
      description: "Remove the current prompt",
      projections: { slash: { aliases: ["clear"], order: 0 }, palette: {} },
    },
    {
      id: "size-landscape",
      title: "Use landscape size",
      category: "Prompt",
      description: "Use 1024 × 768",
      projections: { slash: { aliases: ["landscape"], order: 1 }, palette: {} },
    },
    {
      id: "size-portrait",
      title: "Use portrait size",
      category: "Prompt",
      description: "Use 768 × 1024",
      projections: { slash: { aliases: ["portrait"], order: 2 }, palette: {} },
    },
    {
      id: "size-square",
      title: "Use square size",
      category: "Prompt",
      description: "Use 1024 × 1024",
      projections: { slash: { aliases: ["square"], order: 3 }, palette: {} },
    },
    {
      id: "inspect-generation-draft",
      title: "Inspect image draft",
      category: "Image generation",
      description: "Read the current Prints image form and available models",
      projections: { agent: {} },
    },
    {
      id: "set-generation-draft",
      title: "Edit image draft",
      category: "Image generation",
      description:
        "Set selected Prints image form fields; this does not generate an image",
      projections: { agent: {} },
    },
    {
      id: "submit-generation-draft",
      title: "Generate image",
      category: "Image generation",
      description:
        "Submit the current Prints image form using the same action as the Send button",
      projections: { agent: {} },
    },
  ],
  backend: {
    bindings: [
      { name: "MEDIA", operations: ["models", "generate"] },
      { name: "COMPUTER", operations: ["list", "read"] },
    ],
  },
} as const;
export const groveApp = {
  icon: "chat",
  capabilities: [
    "agent.list",
    "agent.manage",
    "agent.rename",
    "agent.avatar",
    "agent.toolPolicy",
    "agent.read",
    "agent.send",
    "channels.read",
    "channels.personal.manage",
  ],
  handlers: [],
  roles: ["inbox", "sessions"],
  commands: [
    {
      id: "new-conversation",
      title: "New conversation",
      category: "Conversation",
      description: "Start a new conversation with this Agent",
      projections: { slash: { aliases: ["new"], order: 20 }, palette: {} },
    },
    {
      id: "permissions",
      title: "App permissions",
      category: "Conversation",
      description: "Review what Grove may access",
      projections: {
        slash: { aliases: ["permissions"], order: 21 },
        palette: {},
      },
    },
  ],
  displayName: "Grove",
  backend: {
    bindings: [
      { name: "INBOX", operations: ["page", "visit"] },
      { name: "AGENTS", operations: ["send"] },
    ],
  },
} as const;
