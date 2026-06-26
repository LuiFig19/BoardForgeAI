export function buildFreeroutingCommand({ javaPath, jarPath, dsnPath, sesPath, extraArgs = [] } = {}) {
  if (!javaPath || !jarPath || !dsnPath || !sesPath) {
    return { valid: false, command: null, args: [], reason: 'javaPath, jarPath, dsnPath, and sesPath are required.' }
  }
  return {
    valid: true,
    command: javaPath,
    args: ['-jar', jarPath, '-de', dsnPath, '-do', sesPath, ...extraArgs],
    display: `"${javaPath}" -jar "${jarPath}" -de "${dsnPath}" -do "${sesPath}"${extraArgs.length ? ` ${extraArgs.join(' ')}` : ''}`,
  }
}

export function parseFreeroutingProbeOutput(output = '') {
  const version = output.match(/Freerouting v([0-9.]+)/i)?.[1] || null
  const acceptsDsn = /Opening '.*\.dsn'|Couldn't load the input file|setInput|\.dsn/i.test(output)
  const writesSes = /-do|\.ses|output/i.test(output)
  return {
    version,
    acceptsDsn,
    writesSes,
    runnable: /Freerouting v/i.test(output) && acceptsDsn,
  }
}

export function freeroutingInstallRecord({ javaPath, javaVersion, jarPath, freeroutingVersion, installMethod = 'portable_project_tools' } = {}) {
  return {
    javaFound: Boolean(javaPath),
    javaPath,
    javaVersion,
    freeRoutingFound: Boolean(jarPath),
    freeRoutingPath: jarPath,
    freeRoutingVersion: freeroutingVersion,
    installMethod,
  }
}
