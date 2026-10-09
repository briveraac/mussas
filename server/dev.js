import { spawn } from 'node:child_process'
import { projectRoot } from './config.js'
import path from 'node:path'
const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { cwd: projectRoot, stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, [path.join(projectRoot, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', '5173', '--strictPort', '--configLoader', 'native'], { cwd: projectRoot, stdio: 'inherit', windowsHide: true }),
]
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code }
for (const child of children) { child.on('error', error => { console.error(error.message); stop(1) }); child.on('exit', code => stop(code || 0)) }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop())
