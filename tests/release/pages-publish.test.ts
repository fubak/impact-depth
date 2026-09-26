import { describe, expect, it } from 'vitest';
import { publishDecision } from '../../scripts/pages-publish-decision.mjs';

const tip = 'bbbb';
const older = 'aaaa';

describe('pages publish decision', () => {
  it('deploys a successful CI run only while its SHA is still master', () => {
    expect(
      publishDecision({
        event: 'workflow_run',
        conclusion: 'success',
        gates: 'skipped',
        headSha: tip,
        masterTip: tip,
        checkoutSha: tip,
      }),
    ).toEqual({ build: true, deploy: true });
  });

  it('does not let an older green run replace a newer master tip', () => {
    expect(
      publishDecision({
        event: 'workflow_run',
        conclusion: 'success',
        gates: 'skipped',
        headSha: older,
        masterTip: tip,
        checkoutSha: older,
      }),
    ).toEqual({ build: false, deploy: false });
  });

  it('does not deploy failed or cancelled CI', () => {
    for (const conclusion of ['failure', 'cancelled'] as const) {
      expect(
        publishDecision({
          event: 'workflow_run',
          conclusion,
          gates: 'skipped',
          headSha: tip,
          masterTip: tip,
          checkoutSha: tip,
        }).deploy,
      ).toBe(false);
    }
  });

  it('deploys a dispatched revision only after its own gates pass', () => {
    expect(
      publishDecision({
        event: 'workflow_dispatch',
        gates: 'success',
        headSha: older,
        masterTip: tip,
        checkoutSha: older,
      }),
    ).toEqual({ build: true, deploy: true });
    expect(
      publishDecision({
        event: 'workflow_dispatch',
        gates: 'failure',
        headSha: older,
        masterTip: tip,
        checkoutSha: older,
      }).build,
    ).toBe(false);
  });
});
