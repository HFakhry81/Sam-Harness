# Gates: Phase 5 — Near-zero model cost (hybrid routing optimization)

OWNS: src/lib/cost/router.ts, src/lib/cost/difficulty.js, tests/near-zero-cost.test.ts, tests/phase8-team-routing.test.ts

Scope: Complete hybrid routing optimization and verify cost cap enforcement

- [ ] G1: Router module exports resolveModelRoute function
  CHECK: node -e "const fs = require('fs'); console.log(fs.existsSync('src/lib/cost/router.ts') ? 'router:OK' : 'FAIL')"
  EXPECT: router:OK
  EVIDENCE: pending

- [ ] G2: Difficulty classifier exists
  CHECK: node -e "const fs = require('fs'); console.log(fs.existsSync('src/lib/cost/difficulty.js') ? 'difficulty:OK' : 'FAIL')"
  EXPECT: difficulty:OK
  EVIDENCE: pending

- [ ] G3: Near-zero cost tests pass
  CHECK: node -e "const {execSync} = require('child_process'); try { execSync('pnpm test near-zero-cost.test.ts', {stdio:'inherit'}); console.log('G3:tests:passed'); } catch(e) { console.log('G3:tests:failed'); process.exit(1); }"
  EXPECT: G3:tests:passed
  EVIDENCE: pending

- [ ] G4: Phase 8 team routing tests pass
  CHECK: node -e "const {execSync} = require('child_process'); try { execSync('pnpm test phase8-team-routing.test.ts', {stdio:'inherit'}); console.log('G4:tests:passed'); } catch(e) { console.log('G4:tests:failed'); process.exit(1); }"
  EXPECT: G4:tests:passed
  EVIDENCE: pending

- [ ] G5: Cost cap tests pass
  CHECK: node -e "const {execSync} = require('child_process'); try { execSync('pnpm test cost-cap.test.ts', {stdio:'inherit'}); console.log('G5:tests:passed'); } catch(e) { console.log('G5:tests:failed'); process.exit(1); }"
  EXPECT: G5:tests:passed
  EVIDENCE: pending

- [ ] G6: Hybrid profile module exists
  CHECK: node -e "const fs = require('fs'); console.log(fs.existsSync('src/controlplane/hybridProfile.ts') ? 'hybrid-profile:OK' : 'FAIL')"
  EXPECT: hybrid-profile:OK
  EVIDENCE: pending
