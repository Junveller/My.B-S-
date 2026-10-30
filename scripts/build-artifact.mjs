// claude.ai 페이지용 단일 HTML 만들기: vite build --mode artifact → CSS/JS를 한 파일에 인라인
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

execSync('npx vite build --mode artifact', { stdio: 'inherit' });
const dir = new URL('../dist-artifact/assets/', import.meta.url);
const files = readdirSync(dir);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(f, dir), 'utf8'));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(new URL(f, dir), 'utf8'));
if (js.length !== 1) throw new Error(`JS 청크가 하나여야 해요: ${files.join(', ')}`);

const safeScript = js[0].replace(/<\/script/gi, '<\\/script');
const html = `<title>Bisje</title>
<meta name="theme-color" content="#F4F4F2">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<style>
html, body { height: 100%; }
body { background: #F4F4F2; }
${css.join('\n')}
</style>
<div id="root"></div>
<script type="module">
${safeScript}
</script>
`;
writeFileSync(new URL('../dist-artifact/bisje.html', import.meta.url), html);
console.log(`dist-artifact/bisje.html ${(html.length / 1024).toFixed(0)} KB`);
