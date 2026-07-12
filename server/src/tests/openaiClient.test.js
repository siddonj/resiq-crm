jest.mock('../services/integrationSettings', () => ({
  getSetting: jest.fn(),
}));

jest.mock('openai', () => jest.fn((opts) => ({ __apiKey: opts.apiKey })));

const { getSetting } = require('../services/integrationSettings');
const OpenAI = require('openai');
const { getOpenAiClient, isOpenAiConfigured } = require('../services/openaiClient');

describe('openaiClient', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getOpenAiClient returns null when no key is resolved', async () => {
    getSetting.mockResolvedValue(null);

    await expect(getOpenAiClient()).resolves.toBeNull();
    expect(OpenAI).not.toHaveBeenCalled();
  });

  test('getOpenAiClient builds a client from the resolved key', async () => {
    getSetting.mockResolvedValue('sk-test');

    const client = await getOpenAiClient();

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(client).toEqual({ __apiKey: 'sk-test' });
  });

  test('isOpenAiConfigured reflects whether a client could be built', async () => {
    getSetting.mockResolvedValueOnce(null);
    await expect(isOpenAiConfigured()).resolves.toBe(false);

    getSetting.mockResolvedValueOnce('sk-test');
    await expect(isOpenAiConfigured()).resolves.toBe(true);
  });
});
