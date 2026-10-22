import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a healthy status and service identifier', () => {
    const controller = new HealthController();
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('ui-ux-auditor-api');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
