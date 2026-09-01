// TS6 (TS2882) requires type declarations for side-effect CSS imports.
// Vite handles the actual CSS; this only satisfies the type system.
declare module "*.css" {}
