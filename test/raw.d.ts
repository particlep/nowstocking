// Vite's "?raw" imports (a file's text), as in the app's vite/client types.
declare module '*?raw' {
  const text: string;
  export default text;
}
