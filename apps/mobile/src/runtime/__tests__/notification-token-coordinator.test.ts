import { describe, expect, it } from 'vitest';
import { createNotificationTokenCoordinator } from '../notification-token-coordinator';

describe('notification token coordination', () => {
  it('drops a token acquired after notifications are disabled', async () => {
    const coordinator = createNotificationTokenCoordinator();
    const events: string[] = [];
    let releaseToken!: () => void;
    let markAcquiring!: () => void;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    const acquiring = new Promise<void>((resolve) => {
      markAcquiring = resolve;
    });

    coordinator.selectUser('user-1');
    const sync = coordinator.sync(
      'user-1',
      async () => {
        events.push('acquire');
        markAcquiring();
        await tokenGate;
        return 'token';
      },
      () => {
        events.push('register');
      },
    );
    await acquiring;
    coordinator.selectUser(null);
    const revoke = coordinator.revoke(() => {
      events.push('revoke');
    });
    releaseToken();

    await Promise.all([sync, revoke]);
    expect(events).toEqual(['acquire', 'revoke']);
  });

  it('runs revocation after an in-flight registration', async () => {
    const coordinator = createNotificationTokenCoordinator();
    const events: string[] = [];
    let releaseRegistration!: () => void;
    let markRegistering!: () => void;
    const registrationGate = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    const registering = new Promise<void>((resolve) => {
      markRegistering = resolve;
    });

    coordinator.selectUser('user-1');
    const sync = coordinator.sync(
      'user-1',
      () => 'token',
      async () => {
        events.push('register:start');
        markRegistering();
        await registrationGate;
        events.push('register:end');
      },
    );
    await registering;
    coordinator.selectUser(null);
    const revoke = coordinator.revoke(() => {
      events.push('revoke');
    });
    releaseRegistration();

    await Promise.all([sync, revoke]);
    expect(events).toEqual(['register:start', 'register:end', 'revoke']);
  });
});
