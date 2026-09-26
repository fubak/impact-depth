/**
 * Same rules as .github/workflows/pages.yml.
 * Automatic deploys publish only the CI head SHA that is still origin/master.
 * Manual dispatch publishes the selected SHA only after its own gates pass.
 * Failed and cancelled CI runs do not build or deploy.
 * @param {{
 *   event: 'workflow_run' | 'workflow_dispatch',
 *   conclusion?: 'success' | 'failure' | 'cancelled',
 *   gates?: 'success' | 'failure' | 'cancelled' | 'skipped',
 *   headSha: string,
 *   masterTip: string,
 *   checkoutSha: string,
 * }} input
 */
export function publishDecision(input) {
  const gatesOk =
    input.event === 'workflow_dispatch' ? input.gates === 'success' : input.gates === 'skipped';
  const runOk = input.event !== 'workflow_run' || input.conclusion === 'success';
  const fresh = input.event !== 'workflow_run' || input.headSha === input.masterTip;
  const bound = input.checkoutSha === input.headSha;
  const build = gatesOk && runOk && fresh && bound;
  return { build, deploy: build };
}
