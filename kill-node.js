const { execSync } = require('child_process');
try {
  const output = execSync('tasklist /FI "PID ge 100" /FO LIST 2>/dev').toString();
  console.log(output);
} catch(e) {
  console.log("Error:", e.message);
}