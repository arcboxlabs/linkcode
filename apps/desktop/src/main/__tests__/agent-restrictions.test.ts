import { describe, expect, it } from 'vitest';
import { parseDesktopAgentRestrictions } from '../agent-restrictions';

describe('parseDesktopAgentRestrictions', () => {
  it('returns unrestricted when nothing is inlined', () => {
    expect(parseDesktopAgentRestrictions(undefined)).toEqual({
      allowedAgents: null,
      allowedServices: null,
    });
    expect(parseDesktopAgentRestrictions('')).toEqual({
      allowedAgents: null,
      allowedServices: null,
    });
  });

  it('parses a restricted snapshot', () => {
    const restrictions = parseDesktopAgentRestrictions(
      JSON.stringify({ agents: ['pi'], services: ['linkcode-gateway'] }),
    );
    expect(restrictions).toEqual({
      allowedAgents: ['pi'],
      allowedServices: ['linkcode-gateway'],
    });
  });

  it('leaves the other axis unrestricted when only one field is declared', () => {
    expect(parseDesktopAgentRestrictions(JSON.stringify({ agents: ['pi'] }))).toEqual({
      allowedAgents: ['pi'],
      allowedServices: null,
    });
    expect(
      parseDesktopAgentRestrictions(JSON.stringify({ services: ['linkcode-gateway'] })),
    ).toEqual({
      allowedAgents: null,
      allowedServices: ['linkcode-gateway'],
    });
  });

  it('fails closed on malformed JSON instead of falling back to unrestricted', () => {
    expect(() => parseDesktopAgentRestrictions('{not json')).toThrow();
  });

  it('fails closed on an unsupported field', () => {
    expect(() => parseDesktopAgentRestrictions(JSON.stringify({ extra: true }))).toThrow(
      'unsupported field extra',
    );
  });

  it('fails closed on an empty or duplicated agents array', () => {
    expect(() => parseDesktopAgentRestrictions(JSON.stringify({ agents: [] }))).toThrow(
      'non-empty array',
    );
    expect(() => parseDesktopAgentRestrictions(JSON.stringify({ agents: ['pi', 'pi'] }))).toThrow(
      'duplicates',
    );
  });

  it('fails closed on an unknown agent kind', () => {
    expect(() =>
      parseDesktopAgentRestrictions(JSON.stringify({ agents: ['not-a-kind'] })),
    ).toThrow();
  });

  it('fails closed on a malformed service id', () => {
    expect(() =>
      parseDesktopAgentRestrictions(JSON.stringify({ services: ['Not_Valid'] })),
    ).toThrow('invalid service id');
  });
});
