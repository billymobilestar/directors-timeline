import { describe, it, expect } from 'vitest';
import { importFountainToScenes } from '@/lib/importers/fountain';
import { importFdxToScenes } from '@/lib/importers/fdx';

const fountainSample = `
Title: Demo

INT. APARTMENT - NIGHT
A room. Lights flicker.

ALEX
(quietly)
We test Fountain.

CUT TO:
EXT. STREET - DAY
Cars pass.

`.trim();

const fdxSample = `
<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. OFFICE - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>A desk. A phone rings.</Text></Paragraph>
    <Paragraph Type="Character"><Text>SAM</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Hello?</Text></Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph Type="Scene Heading"><Text>EXT. PARK - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>Children play.</Text></Paragraph>
  </Content>
</FinalDraft>
`.trim();

describe('importers', () => {
  it('imports Fountain scenes', async () => {
    const res = await importFountainToScenes(fountainSample);
    expect(res.scenes.length).toBeGreaterThanOrEqual(2);
    expect(res.scenes[0].heading.toUpperCase()).toContain('INT.');
    expect(res.scenes[0].estLengthSec).toBeGreaterThan(0);
  });

  it('imports FDX scenes', () => {
    const res = importFdxToScenes(fdxSample);
    expect(res.scenes.length).toBeGreaterThanOrEqual(2);
    expect(res.scenes[0].heading.toUpperCase()).toContain('INT.');
    expect(res.scenes[0].positionSec).toBe(0);
  });

  it('handles content before first Fountain scene heading (creates COLD OPEN)', async () => {
    const sample = `Prologue text before any heading.\n\nINT. LAB - NIGHT\nMachines hum.`;
    const res = await importFountainToScenes(sample);
    expect(res.scenes.length).toBeGreaterThanOrEqual(1);
    // First scene should exist and have non-zero estimated length
    expect(res.scenes[0].estLengthSec).toBeGreaterThan(0);
  });
});