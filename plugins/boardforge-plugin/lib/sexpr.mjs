export function parseSExpr(text) {
  const tokens = tokenize(text)
  const stack = []
  const roots = []
  for (const token of tokens) {
    if (token === '(') {
      const node = []
      if (stack.length) stack[stack.length - 1].push(node)
      else roots.push(node)
      stack.push(node)
    } else if (token === ')') {
      if (!stack.length) throw new Error('Unexpected closing parenthesis in S-expression.')
      stack.pop()
    } else if (!stack.length) {
      roots.push(atom(token))
    } else {
      stack[stack.length - 1].push(atom(token))
    }
  }
  if (stack.length) throw new Error('Unclosed S-expression.')
  return roots.length === 1 ? roots[0] : roots
}

export function child(node, name) {
  return children(node, name)[0] || null
}

export function children(node, name) {
  if (!Array.isArray(node)) return []
  return node.filter((item) => Array.isArray(item) && (name === null || item[0] === name))
}

export function descendants(node, name) {
  const found = []
  walk(node, (item) => {
    if (Array.isArray(item) && (name === null || item[0] === name)) found.push(item)
  })
  return found
}

export function atomText(value) {
  if (value === undefined || value === null) return null
  return String(value)
}

export function atomNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function nodeName(node) {
  return Array.isArray(node) ? node[0] : null
}

function tokenize(text) {
  const tokens = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === ';') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '(' || char === ')') {
      tokens.push(char)
      index += 1
      continue
    }
    if (char === '"') {
      let value = ''
      index += 1
      while (index < text.length) {
        const next = text[index]
        if (next === '\\') {
          value += text[index + 1] || ''
          index += 2
          continue
        }
        if (next === '"') {
          index += 1
          break
        }
        value += next
        index += 1
      }
      tokens.push({ quoted: value })
      continue
    }
    let value = ''
    while (index < text.length && !/\s|\(|\)/.test(text[index])) {
      value += text[index]
      index += 1
    }
    tokens.push(value)
  }
  return tokens
}

function atom(token) {
  if (typeof token === 'object' && token?.quoted !== undefined) return token.quoted
  return token
}

function walk(node, visit) {
  if (!Array.isArray(node)) return
  for (const item of node) {
    if (Array.isArray(item)) {
      visit(item)
      walk(item, visit)
    }
  }
}
