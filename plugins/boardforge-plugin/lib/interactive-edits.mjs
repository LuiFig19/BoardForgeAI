import { createBoardShape } from './templates.mjs'
import { generatePlacementPlan } from './placement.mjs'

export function parseInteractiveEdit(prompt = '') {
  const text = String(prompt).toLowerCase()
  const edits = []
  const wider = text.match(/(?:wider|widen|bigger|larger).*?(\d+(?:\.\d+)?)\s*mm/) || text.match(/(\d+(?:\.\d+)?)\s*mm.*?(?:wider|widen|bigger|larger)/)
  if (wider) edits.push({ type: 'resize_board', axis: 'width', deltaMm: Number(wider[1]) })
  if (/round/.test(text) && /corner/.test(text)) edits.push({ type: 'round_corners', radiusMm: Number(text.match(/(\d+(?:\.\d+)?)\s*mm/)?.[1] || 3) })
  if (/usb/.test(text) && /left/.test(text)) edits.push({ type: 'move_group_to_edge', group: 'USB', edge: 'left' })
  if (/antenna/.test(text) && /(clear|keepout|keep out)/.test(text)) edits.push({ type: 'enforce_keepout', kind: 'antenna_keepout' })
  if (/(thicker|wider)/.test(text) && /(power|vin|vbat)/.test(text)) edits.push({ type: 'increase_net_width', className: 'POWER_HIGH_CURRENT' })
  return { status: edits.length ? 'INTERACTIVE_EDITS_PARSED_NEEDS_REVIEW' : 'INTERACTIVE_EDIT_NEEDS_CLARIFICATION', prompt, edits, humanReviewRequired: true }
}

export function applyInteractiveEdits({ board, components = [], profile, prompt }) {
  const parsed = parseInteractiveEdit(prompt)
  let nextBoard = { ...board }
  let nextComponents = components.map((component) => ({ ...component }))
  for (const edit of parsed.edits) {
    if (edit.type === 'resize_board') {
      nextBoard.widthMm = Number(nextBoard.widthMm || 50) + edit.deltaMm
      nextBoard.outline = createBoardShape('rounded_rectangle', nextBoard.widthMm, nextBoard.heightMm || 30, { radiusMm: nextBoard.cornerRadiusMm || 3 })
    }
    if (edit.type === 'round_corners') {
      nextBoard.cornerRadiusMm = edit.radiusMm
      nextBoard.outline = createBoardShape('rounded_rectangle', nextBoard.widthMm || 50, nextBoard.heightMm || 30, { radiusMm: edit.radiusMm })
    }
    if (edit.type === 'move_group_to_edge') {
      nextComponents = nextComponents.map((component) => component.group === edit.group ? { ...component, x: 4 + (component.width || 8) / 2, rotation: 90 } : component)
    }
  }
  const placement = generatePlacementPlan(nextBoard, null, profile)
  return { ...parsed, board: nextBoard, components: nextComponents, placementReview: placement, status: 'INTERACTIVE_EDITS_APPLIED_NEEDS_REVIEW' }
}
