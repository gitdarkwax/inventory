import { beforeEach, describe, expect, it, vi } from 'vitest';

const afterMock = vi.hoisted(() => vi.fn());
vi.mock('next/server', () => ({ after: afterMock }));

import { sendSlackNotification } from './slack';

beforeEach(() => {
  afterMock.mockReset();
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_CHANNEL_TEST = 'C000';
});

describe('sendSlackNotification', () => {
  it('registers the send so the function stays alive until it finishes', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    await sendSlackNotification(notify, 'SLACK_CHANNEL_TEST');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it('works outside a request and never throws on Slack errors', async () => {
    afterMock.mockImplementation(() => {
      throw new Error('after() called outside a request scope');
    });
    const notify = vi.fn().mockRejectedValue(new Error('slack down'));
    await expect(sendSlackNotification(notify, 'SLACK_CHANNEL_TEST')).resolves.toBeUndefined();
  });

  it('skips quietly when the channel is not configured', async () => {
    const notify = vi.fn();
    await sendSlackNotification(notify, 'SLACK_CHANNEL_MISSING');
    expect(notify).not.toHaveBeenCalled();
  });
});
