import { defineConfig, loadEnv } from 'vite';

// CSP só no build: em dev o Vite injeta estilos inline e usa websocket (HMR).
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd());
  const supabase = env.VITE_SUPABASE_URL ?? '';
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  return {
    // caminho relativo: funciona em usuario.github.io/<repo>/
    base: './',
    plugins: [
      {
        name: 'csp',
        transformIndexHtml(html) {
          if (command !== 'build') return html;
          return html.replace(
            '<!--CSP-->',
            `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
          );
        },
      },
    ],
  };
});
