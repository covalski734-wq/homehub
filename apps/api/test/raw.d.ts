// SQL files imported as text by tests (Vite ?raw).
declare module '*.sql?raw' {
  const text: string;
  export default text;
}
