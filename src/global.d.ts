// Ambient module declarations for non-code imports.
//
// Next.js handles CSS imports through its webpack pipeline at build time, but
// the TypeScript language server has no built-in knowledge of `.css` files,
// so editor tooling flags side-effect imports like `import './globals.css'`.
// This wildcard declaration tells TS "trust me, these modules exist" without
// affecting runtime or the production build.
declare module '*.css';
