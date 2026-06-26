import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const trustedSuppliers = ['Digi-Key', 'Mouser', 'Newark', 'element14', 'Arrow', 'Manufacturer Direct']

export function supplierApiConfig(env = process.env) {
  return {
    digikey: {
      configured: Boolean(env.DIGIKEY_CLIENT_ID && env.DIGIKEY_CLIENT_SECRET && env.DIGIKEY_OAUTH_TOKEN_URL),
      requiredEnv: ['DIGIKEY_CLIENT_ID', 'DIGIKEY_CLIENT_SECRET', 'DIGIKEY_OAUTH_TOKEN_URL', 'DIGIKEY_BASE_URL'],
    },
    mouser: {
      configured: Boolean(env.MOUSER_API_KEY),
      requiredEnv: ['MOUSER_API_KEY'],
    },
    newark: {
      configured: Boolean(env.NEWARK_API_KEY || env.ELEMENT14_API_KEY),
      requiredEnv: ['NEWARK_API_KEY or ELEMENT14_API_KEY'],
    },
    arrow: {
      configured: Boolean(env.ARROW_API_KEY),
      requiredEnv: ['ARROW_API_KEY'],
    },
  }
}

export async function querySupplierStock({ partNumber, supplier, env = process.env, manualStock = null, fetchImpl = globalThis.fetch, minimumRequiredQty = 1 } = {}) {
  if (!partNumber) return { status: 'REJECTED_MISSING_PART_NUMBER', supplier, stockVerified: false }
  if (!trustedSuppliers.includes(supplier)) return { status: 'REJECTED_UNTRUSTED_SUPPLIER', supplier, partNumber, stockVerified: false }
  if (manualStock) return normalizeManualStock({ partNumber, supplier, manualStock })
  const config = supplierApiConfig(env)
  const key = supplierKey(supplier)
  if (!config[key]?.configured) {
    return {
      status: 'NEEDS_STOCK_VERIFICATION',
      supplier,
      partNumber,
      stockVerified: false,
      reason: `${supplier} API credentials are not configured. BoardForge will not fake live stock.`,
      requiredEnv: config[key]?.requiredEnv || [],
    }
  }
  if (key === 'digikey') {
    return queryDigikeyStock({ partNumber, env, fetchImpl, minimumRequiredQty })
  }
  return {
    status: 'SUPPLIER_API_NOT_IMPLEMENTED_LIVE_QUERY_REQUIRED',
    supplier,
    partNumber,
    stockVerified: false,
    reason: 'Supplier credentials are configured, but this offline runner has no live supplier adapter implementation yet.',
  }
}

export async function checkPartAvailability(candidate = {}, options = {}) {
  const supplier = candidate.supplier || 'Digi-Key'
  const partNumber = candidate.replacementPart || candidate.partNumber || candidate.mpn
  return querySupplierStock({
    partNumber,
    supplier,
    env: options.env || process.env,
    manualStock: candidate.manualStock || options.manualStock || null,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    minimumRequiredQty: candidate.minimumRequiredQty || options.minimumRequiredQty || 1,
  })
}

export async function getDigikeyAccessToken({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const missing = ['DIGIKEY_CLIENT_ID', 'DIGIKEY_CLIENT_SECRET', 'DIGIKEY_OAUTH_TOKEN_URL'].filter((name) => !env[name])
  if (missing.length) {
    return {
      status: 'DIGIKEY_OAUTH_NOT_CONFIGURED',
      accessToken: null,
      stockVerified: false,
      missingEnv: missing,
      reason: 'Digi-Key OAuth credentials are not visible to this process. BoardForge will not fake live stock.',
    }
  }
  if (typeof fetchImpl !== 'function') {
    return {
      status: 'DIGIKEY_FETCH_UNAVAILABLE',
      accessToken: null,
      stockVerified: false,
      reason: 'No fetch implementation is available for Digi-Key OAuth.',
    }
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.DIGIKEY_CLIENT_ID,
    client_secret: env.DIGIKEY_CLIENT_SECRET,
  })
  const response = await fetchImpl(env.DIGIKEY_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const json = await safeJson(response)
  if (!response?.ok || !json?.access_token) {
    return {
      status: 'DIGIKEY_OAUTH_FAILED',
      accessToken: null,
      stockVerified: false,
      httpStatus: response?.status || null,
      reason: json?.error_description || json?.error || 'Digi-Key OAuth did not return an access token.',
    }
  }
  return {
    status: 'DIGIKEY_OAUTH_TOKEN_READY',
    accessToken: json.access_token,
    expiresIn: json.expires_in || null,
    tokenType: json.token_type || 'Bearer',
  }
}

export async function digikeyKeywordSearch({ keyword, accessToken, env = process.env, fetchImpl = globalThis.fetch, limit = 10 } = {}) {
  if (!keyword) return { status: 'REJECTED_MISSING_KEYWORD', products: [] }
  if (!accessToken) return { status: 'REJECTED_MISSING_DIGIKEY_ACCESS_TOKEN', products: [] }
  const baseUrl = trimTrailingSlash(env.DIGIKEY_BASE_URL || 'https://api.digikey.com')
  const response = await fetchImpl(`${baseUrl}/products/v4/search/keyword`, {
    method: 'POST',
    headers: digikeyHeaders({ accessToken, env }),
    body: JSON.stringify({ Keywords: keyword, Limit: limit, Offset: 0 }),
  })
  const json = await safeJson(response)
  return {
    status: response?.ok ? 'DIGIKEY_KEYWORD_SEARCH_READY' : 'DIGIKEY_KEYWORD_SEARCH_FAILED',
    httpStatus: response?.status || null,
    raw: json,
    products: normalizeDigikeyProducts(json),
  }
}

export async function digikeyProductDetails({ productNumber, accessToken, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!productNumber) return { status: 'REJECTED_MISSING_PRODUCT_NUMBER', product: null }
  if (!accessToken) return { status: 'REJECTED_MISSING_DIGIKEY_ACCESS_TOKEN', product: null }
  const baseUrl = trimTrailingSlash(env.DIGIKEY_BASE_URL || 'https://api.digikey.com')
  const response = await fetchImpl(`${baseUrl}/products/v4/search/${encodeURIComponent(productNumber)}/productdetails`, {
    method: 'GET',
    headers: digikeyHeaders({ accessToken, env }),
  })
  const json = await safeJson(response)
  const product = json?.Product || json?.product || json
  return {
    status: response?.ok ? 'DIGIKEY_PRODUCT_DETAILS_READY' : 'DIGIKEY_PRODUCT_DETAILS_FAILED',
    httpStatus: response?.status || null,
    raw: json,
    product: normalizeDigikeyProduct(product),
  }
}

export async function digikeyPricing({ productNumber, accessToken, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!productNumber) return { status: 'REJECTED_MISSING_PRODUCT_NUMBER', pricing: null }
  if (!accessToken) return { status: 'REJECTED_MISSING_DIGIKEY_ACCESS_TOKEN', pricing: null }
  const baseUrl = trimTrailingSlash(env.DIGIKEY_BASE_URL || 'https://api.digikey.com')
  const response = await fetchImpl(`${baseUrl}/products/v4/search/${encodeURIComponent(productNumber)}/pricing`, {
    method: 'GET',
    headers: digikeyHeaders({ accessToken, env }),
  })
  const json = await safeJson(response)
  return {
    status: response?.ok ? 'DIGIKEY_PRICING_READY' : 'DIGIKEY_PRICING_FAILED',
    httpStatus: response?.status || null,
    raw: json,
    pricing: normalizeDigikeyPricing(json),
  }
}

export async function queryDigikeyStock({ partNumber, env = process.env, fetchImpl = globalThis.fetch, minimumRequiredQty = 1 } = {}) {
  const token = await getDigikeyAccessToken({ env, fetchImpl })
  if (!token.accessToken) {
    return {
      status: 'NEEDS_STOCK_VERIFICATION',
      supplier: 'Digi-Key',
      partNumber,
      stockVerified: false,
      reason: token.reason,
      requiredEnv: token.missingEnv || supplierApiConfig(env).digikey.requiredEnv,
    }
  }
  const search = await digikeyKeywordSearch({ keyword: partNumber, accessToken: token.accessToken, env, fetchImpl, limit: 10 })
  if (search.status !== 'DIGIKEY_KEYWORD_SEARCH_READY') {
    return {
      status: 'REJECTED_UNVERIFIED_STOCK',
      supplier: 'Digi-Key',
      partNumber,
      stockVerified: false,
      reason: 'Digi-Key KeywordSearch failed; stock was not verified.',
      httpStatus: search.httpStatus,
    }
  }
  const selected = selectBestDigikeyProduct(search.products, partNumber)
  if (!selected) {
    return {
      status: 'REJECTED_UNVERIFIED_STOCK',
      supplier: 'Digi-Key',
      partNumber,
      stockVerified: false,
      reason: 'Digi-Key KeywordSearch returned no matching product.',
    }
  }
  const productNumber = selected.supplierSku || selected.productNumber || partNumber
  const details = await digikeyProductDetails({ productNumber, accessToken: token.accessToken, env, fetchImpl })
  const pricing = await digikeyPricing({ productNumber, accessToken: token.accessToken, env, fetchImpl })
  const detailProduct = details.product || {}
  const merged = { ...selected, ...detailProduct }
  const stockQty = Number(merged.stockQty ?? selected.stockQty ?? 0)
  const lifecycleStatus = merged.lifecycleStatus || selected.lifecycleStatus || 'unknown'
  const supplierSku = merged.supplierSku || selected.supplierSku || productNumber
  const unitPrice = pricing.pricing?.unitPrice ?? merged.unitPrice ?? selected.unitPrice ?? null
  const base = {
    supplier: 'Digi-Key',
    partNumber: merged.manufacturerPartNumber || selected.manufacturerPartNumber || partNumber,
    manufacturer: merged.manufacturer || selected.manufacturer || null,
    supplierSku,
    stockQty,
    unitPrice,
    leadTime: merged.leadTime || selected.leadTime || null,
    lifecycleStatus,
    datasheetUrl: merged.datasheetUrl || selected.datasheetUrl || null,
    stockVerified: true,
    liveApiVerified: true,
    sourceEndpoints: ['KeywordSearch', 'ProductDetails', 'ProductPricing'],
  }
  if (stockQty < Number(minimumRequiredQty || 1)) {
    return { ...base, status: 'REJECTED_OUT_OF_STOCK' }
  }
  if (/obsolete/i.test(String(lifecycleStatus))) {
    return { ...base, status: 'REJECTED_OBSOLETE' }
  }
  return { ...base, status: 'DIGIKEY_STOCK_VERIFIED' }
}

export function verifyReplacementLifecycle(candidate = {}) {
  const status = String(candidate.lifecycleStatus || 'unknown').toLowerCase()
  if (status === 'obsolete') return { status: 'REJECTED_OBSOLETE', approved: false }
  if (status === 'nrnd') return { status: 'NEEDS_LIFECYCLE_REVIEW', approved: false }
  if (status === 'active') return { status: 'LIFECYCLE_ACCEPTED', approved: true }
  return { status: 'NEEDS_LIFECYCLE_REVIEW', approved: false }
}

export function compareElectricalRatings(candidate = {}) {
  const checks = {
    sameFunction: candidate.sameFunction === true,
    sameOrBetterVoltageRating: candidate.sameOrBetterVoltageRating === true,
    sameOrBetterCurrentRating: candidate.sameOrBetterCurrentRating === true,
    sameOrBetterThermalRating: candidate.sameOrBetterThermalRating === true,
  }
  return {
    status: Object.values(checks).every(Boolean) ? 'ELECTRICAL_COMPATIBILITY_ACCEPTED' : 'ELECTRICAL_COMPATIBILITY_REJECTED',
    approved: Object.values(checks).every(Boolean),
    checks,
  }
}

export function verifyPinoutCompatibility(candidate = {}) {
  return candidate.pinoutVerified === true
    ? { status: 'PINOUT_COMPATIBILITY_ACCEPTED', approved: true }
    : { status: 'PINOUT_COMPATIBILITY_REJECTED', approved: false }
}

export function verifyFootprintCompatibility(candidate = {}) {
  return candidate.footprintVerified === true
    ? { status: 'FOOTPRINT_COMPATIBILITY_ACCEPTED', approved: true }
    : { status: 'FOOTPRINT_COMPATIBILITY_REJECTED', approved: false }
}

export function scoreReplacementAvailability(candidate = {}, stock = {}) {
  let score = 0
  if (stock.stockVerified) score += 40
  if (Number(stock.stockQty || 0) >= Number(candidate.minimumRequiredQty || 1)) score += 20
  if (candidate.lifecycleStatus === 'active') score += 10
  if (candidate.sameOrBetterVoltageRating) score += 8
  if (candidate.sameOrBetterCurrentRating) score += 8
  if (candidate.sameOrBetterThermalRating) score += 8
  if (candidate.pinoutVerified) score += 3
  if (candidate.footprintVerified) score += 3
  return score
}

export function rejectUnavailableReplacement(candidate = {}, stock = {}) {
  if (stock.status === 'REJECTED_OUT_OF_STOCK') return { rejected: true, status: 'REJECTED_OUT_OF_STOCK' }
  if (!stock.stockVerified) return { rejected: true, status: stock.status === 'NEEDS_STOCK_VERIFICATION' ? 'NEEDS_STOCK_VERIFICATION' : 'REJECTED_UNVERIFIED_STOCK' }
  if (Number(stock.stockQty || 0) < Number(candidate.minimumRequiredQty || 1)) return { rejected: true, status: 'REJECTED_OUT_OF_STOCK' }
  return { rejected: false, status: 'STOCK_ACCEPTED' }
}

export async function evaluateReplacementCandidate(candidate = {}, options = {}) {
  const stock = await checkPartAvailability(candidate, options)
  const electrical = compareElectricalRatings(candidate)
  const lifecycle = verifyReplacementLifecycle(candidate)
  const pinout = verifyPinoutCompatibility(candidate)
  const footprint = verifyFootprintCompatibility(candidate)
  const stockDecision = rejectUnavailableReplacement(candidate, stock)
  const approvedForUse = electrical.approved && lifecycle.approved && pinout.approved && footprint.approved && !stockDecision.rejected
  return {
    ...candidate,
    supplier: candidate.supplier || stock.supplier || 'Digi-Key',
    stock,
    electrical,
    lifecycle,
    pinout,
    footprint,
    availabilityScore: scoreReplacementAvailability(candidate, stock),
    status: approvedForUse ? 'REPLACEMENT_APPROVED_FOR_USE' : stockDecision.status,
    approvedForUse,
  }
}

export async function generateReplacementSourcingReport({ projectDir, candidates = [], env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const evaluated = []
  for (const candidate of candidates) evaluated.push(await evaluateReplacementCandidate(candidate, { env, fetchImpl }))
  const accepted = evaluated.filter((item) => item.approvedForUse).sort((a, b) => b.availabilityScore - a.availabilityScore)
  const rejected = evaluated.filter((item) => !item.approvedForUse)
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    supplierLayerImplemented: true,
    suppliersChecked: trustedSuppliers,
    apiKeysConfigured: supplierApiConfig(env),
    acceptedCandidates: accepted,
    rejectedCandidates: rejected,
    selectedReplacement: accepted[0] || null,
    bomUpdated: false,
    rule: 'No replacement can be applied until electrical compatibility and verified stock checks both pass.',
  }
  if (projectDir) {
    await mkdir(projectDir, { recursive: true })
    const jsonPath = path.join(projectDir, 'boardforge-esc-replacement-sourcing.json')
    const mdPath = path.join(projectDir, 'BoardForge_ESC_Replacement_Sourcing_Report.md')
    await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')
    await writeFile(mdPath, markdownReport(report), 'utf8')
    report.outputFiles = { json: jsonPath, markdown: mdPath }
  }
  return report
}

function normalizeManualStock({ partNumber, supplier, manualStock = {} }) {
  const stockQty = Number(manualStock.stockQty || 0)
  return {
    status: stockQty > 0 ? 'STOCK_VERIFIED_MANUAL_REVIEW' : 'REJECTED_OUT_OF_STOCK',
    supplier,
    partNumber,
    supplierSku: manualStock.supplierSku || null,
    stockQty,
    unitPrice: manualStock.unitPrice ?? null,
    leadTime: manualStock.leadTime || null,
    lifecycleStatus: manualStock.lifecycleStatus || 'unknown',
    datasheetUrl: manualStock.datasheetUrl || null,
    stockVerified: stockQty > 0,
    manualReview: true,
  }
}

function digikeyHeaders({ accessToken, env }) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-DIGIKEY-Client-Id': env.DIGIKEY_CLIENT_ID,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function trimTrailingSlash(value = '') {
  return String(value).replace(/\/+$/, '')
}

function normalizeDigikeyProducts(json = {}) {
  const products = json?.Products || json?.products || json?.ProductDetails || json?.productDetails || []
  return products.map((product) => normalizeDigikeyProduct(product))
}

function normalizeDigikeyProduct(product = {}) {
  const manufacturer = product.Manufacturer?.Name || product.Manufacturer?.Value || product.Manufacturer || product.manufacturer || null
  const productStatus = product.ProductStatus?.Status || product.ProductStatus || product.LifecycleStatus || product.Status || product.productStatus || 'unknown'
  const productNumber = product.DigiKeyProductNumber || product.ProductNumber || product.productNumber || product.SupplierProductNumber || null
  const manufacturerPartNumber = product.ManufacturerProductNumber || product.ManufacturerPartNumber || product.MfrPartNumber || product.partNumber || null
  return {
    productNumber,
    supplierSku: productNumber,
    manufacturerPartNumber,
    manufacturer,
    stockQty: Number(product.QuantityAvailable ?? product.AvailableQuantity ?? product.Quantity ?? product.stockQty ?? 0),
    lifecycleStatus: productStatus,
    datasheetUrl: product.DatasheetUrl || product.DatasheetURL || product.PrimaryDatasheet || product.datasheetUrl || null,
    unitPrice: product.UnitPrice || product.unitPrice || null,
    leadTime: product.LeadTime || product.leadTime || null,
    raw: product,
  }
}

function normalizeDigikeyPricing(json = {}) {
  const breaks = json?.ProductPricing || json?.Pricing || json?.PricingOptions || json?.pricing || []
  const first = Array.isArray(breaks) ? breaks[0] : breaks
  return {
    unitPrice: first?.UnitPrice || first?.unitPrice || first?.Price || first?.price || null,
    priceBreaks: breaks,
  }
}

function selectBestDigikeyProduct(products = [], requestedPartNumber = '') {
  if (!products.length) return null
  const requested = String(requestedPartNumber).toLowerCase()
  return products.find((item) => String(item.manufacturerPartNumber || '').toLowerCase() === requested)
    || products.find((item) => String(item.supplierSku || '').toLowerCase() === requested)
    || products[0]
}

function supplierKey(supplier = '') {
  if (/digi/i.test(supplier)) return 'digikey'
  if (/mouser/i.test(supplier)) return 'mouser'
  if (/newark|element14/i.test(supplier)) return 'newark'
  if (/arrow/i.test(supplier)) return 'arrow'
  return 'manufacturer'
}

function markdownReport(report) {
  const lines = [
    '# BoardForge ESC Replacement Sourcing Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Policy',
    report.rule,
    '',
    '## API configuration',
    ...Object.entries(report.apiKeysConfigured).map(([name, cfg]) => `- ${name}: ${cfg.configured ? 'configured' : 'not configured'} (${cfg.requiredEnv.join(', ')})`),
    '',
    '## Accepted candidates',
    report.acceptedCandidates.length ? '' : '- none',
    ...report.acceptedCandidates.map((item) => `- ${item.ref}: ${item.replacementPart} via ${item.supplier}, stock ${item.stock.stockQty}`),
    '',
    '## Rejected candidates',
    report.rejectedCandidates.length ? '' : '- none',
    ...report.rejectedCandidates.map((item) => `- ${item.ref || 'unknown'}: ${item.replacementPart || 'unknown'} -> ${item.status}`),
  ]
  return `${lines.join('\n')}\n`
}
