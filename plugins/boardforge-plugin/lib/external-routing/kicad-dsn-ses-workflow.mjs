export function detectDsnSesWorkflow({ cliExportHelp = '', cliImportHelp = '', guiKnownAvailable = true, pythonApiMethods = [] } = {}) {
  const cliDsnExport = /\bdsn\b|specctra/i.test(cliExportHelp)
  const cliSesImport = /\bses\b|specctra/i.test(cliImportHelp)
  const pythonDsnExport = pythonApiMethods.some((method) => /dsn|specctra/i.test(method) && /export|save|write/i.test(method))
  const pythonSesImport = pythonApiMethods.some((method) => /ses|specctra/i.test(method) && /import|load|read/i.test(method))
  const selectedWorkflow = cliDsnExport && cliSesImport
    ? 'kicad_cli_dsn_ses'
    : pythonDsnExport && pythonSesImport
      ? 'kicad_python_dsn_ses'
      : guiKnownAvailable
        ? 'manual_kicad_gui_dsn_ses'
        : null
  return {
    cliDsnExport,
    cliSesImport,
    guiDsnExport: Boolean(guiKnownAvailable),
    guiSesImport: Boolean(guiKnownAvailable),
    pythonDsnExport,
    pythonSesImport,
    selectedWorkflow,
  }
}

export function buildManualDsnSesWorkflow({ projectPath, pcbFile = 'FN-ESC1.kicad_pcb', dsnPath, sesPath, freeroutingCommand } = {}) {
  return {
    projectPath,
    pcbFile,
    dsnPath,
    sesPath,
    freeroutingCommand,
    steps: [
      `Open ${pcbFile} in KiCad PCB Editor.`,
      `Use File > Export > Specctra DSN and save to ${dsnPath}.`,
      `Run: ${freeroutingCommand}`,
      `In FreeRouting, save/export the routed session to ${sesPath} if the command did not produce it automatically.`,
      `Return to KiCad PCB Editor and use File > Import > Specctra Session to import ${sesPath}.`,
      'Save the KiCad board.',
      'Run BoardForge DRC/ERC validation and forbidden-via/original-spec checks.',
    ],
  }
}
