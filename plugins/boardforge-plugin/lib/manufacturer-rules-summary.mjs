import { manufacturerProfiles } from './manufacturers.mjs'

export function summarizeManufacturerRules(input = {}) {
  const selected = input.profile || manufacturerProfiles[input.manufacturerProfile] || manufacturerProfiles.JLCPCB_STANDARD
  const comparisons = Object.values(manufacturerProfiles).map((profile) => ({
    id: profile.id,
    name: profile.name,
    minTraceWidthMm: profile.minTraceWidthMm,
    minClearanceMm: profile.minClearanceMm,
    minViaDiameterMm: profile.minViaDiameterMm,
    minViaDrillMm: profile.minViaDrillMm,
    layerOptions: profile.layerOptions,
    hdiSupport: profile.hdi,
    suitabilityScore: suitability(profile, input),
  })).sort((a, b) => b.suitabilityScore - a.suitabilityScore)
  const warnings = []
  if (input.layerCount && !selected.layerOptions?.includes(Number(input.layerCount))) warnings.push(issue('WARNING', 'LAYER_COUNT_NOT_STANDARD', `${selected.name} profile does not list ${input.layerCount} layers as a standard option.`))
  if (input.allowMicrovias && !/supported|review|quote/i.test(selected.hdi?.microvias || '')) warnings.push(issue('WARNING', 'MICROVIA_PROFILE_REVIEW', `${selected.name} does not directly support microvias in this profile.`))
  return {
    schemaVersion: 1,
    status: warnings.length ? 'MANUFACTURER_RULES_NEEDS_REVIEW' : 'MANUFACTURER_RULES_READY',
    selected,
    comparisons,
    hardLimits: {
      minTraceWidthMm: selected.minTraceWidthMm,
      minClearanceMm: selected.minClearanceMm,
      minViaDiameterMm: selected.minViaDiameterMm,
      minViaDrillMm: selected.minViaDrillMm,
      edgeClearanceMm: selected.edgeClearanceMm,
      componentToComponentClearanceMm: selected.componentToComponentClearanceMm,
    },
    warnings,
    errors: [],
    humanReviewRequired: true,
  }
}

function suitability(profile, input) {
  let score = 70
  if (input.layerCount && profile.layerOptions?.includes(Number(input.layerCount))) score += 10
  if (input.allowMicrovias && /supported/i.test(profile.hdi?.microvias || '')) score += 10
  if (input.allowBlindVias && /supported/i.test(profile.hdi?.blindVias || '')) score += 8
  if (input.highDensity && profile.minTraceWidthMm <= 0.1) score += 8
  if (input.lowCost && /advanced/i.test(profile.name)) score -= 20
  return Math.max(0, Math.min(100, score))
}

function issue(severity, code, message, details = {}) {
  return { severity, code, message, details }
}
