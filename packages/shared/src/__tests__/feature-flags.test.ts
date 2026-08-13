import { describe, it, expect, afterEach } from 'bun:test';
import { isDevRuntime, isDeveloperFeedbackEnabled, isOPCAgentCliEnabled, isEmbeddedServerEnabled } from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  OPCAGENT_DEBUG: process.env.OPCAGENT_DEBUG,
  OPCAGENT_FEATURE_DEVELOPER_FEEDBACK: process.env.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK,
  OPCAGENT_FEATURE_CLI: process.env.OPCAGENT_FEATURE_CLI,
  OPCAGENT_FEATURE_EMBEDDED_SERVER: process.env.OPCAGENT_FEATURE_EMBEDDED_SERVER,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.OPCAGENT_DEBUG === undefined) delete process.env.OPCAGENT_DEBUG;
  else process.env.OPCAGENT_DEBUG = ORIGINAL_ENV.OPCAGENT_DEBUG;

  if (ORIGINAL_ENV.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.OPCAGENT_FEATURE_CLI === undefined) delete process.env.OPCAGENT_FEATURE_CLI;
  else process.env.OPCAGENT_FEATURE_CLI = ORIGINAL_ENV.OPCAGENT_FEATURE_CLI;

  if (ORIGINAL_ENV.OPCAGENT_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.OPCAGENT_FEATURE_EMBEDDED_SERVER;
  else process.env.OPCAGENT_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.OPCAGENT_FEATURE_EMBEDDED_SERVER;
});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.OPCAGENT_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for OPCAGENT_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.OPCAGENT_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OPCAGENT_DEBUG;
    process.env.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.OPCAGENT_DEBUG = '1';
    delete process.env.OPCAGENT_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isOPCAgentCliEnabled defaults to false when no override is set', () => {
    delete process.env.OPCAGENT_FEATURE_CLI;

    expect(isOPCAgentCliEnabled()).toBe(false);
  });

  it('isOPCAgentCliEnabled honors explicit override true', () => {
    process.env.OPCAGENT_FEATURE_CLI = '1';

    expect(isOPCAgentCliEnabled()).toBe(true);
  });

  it('isOPCAgentCliEnabled honors explicit override false', () => {
    process.env.OPCAGENT_FEATURE_CLI = '0';

    expect(isOPCAgentCliEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled defaults to false when no override is set', () => {
    delete process.env.OPCAGENT_FEATURE_EMBEDDED_SERVER;

    expect(isEmbeddedServerEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled honors explicit override true', () => {
    process.env.OPCAGENT_FEATURE_EMBEDDED_SERVER = '1';

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override false', () => {
    process.env.OPCAGENT_FEATURE_EMBEDDED_SERVER = '0';

    expect(isEmbeddedServerEnabled()).toBe(false);
  });
});
