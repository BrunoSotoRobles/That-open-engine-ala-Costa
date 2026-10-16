const { spawn } = require('child_process');
const path = require('path');
const browser = process.env.BROWSER || 'firefox';
const env = { ...process.env, BROWSER: browser };

const child = spawn('npx', ['vite'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
});

child.on('exit', (code) => {
  process.exit(code);
});

child.on('error', (error) => {
  console.error('Error launching Vite:', error);
  process.exit(1);
});
