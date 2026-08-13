const python = Bun.which('python3') ?? Bun.which('python')
if (!python) {
  console.error('Python 3 is required to run document tool tests')
  process.exit(1)
}

const modules = [
  'apps.electron.resources.scripts.tests.test_pdf_tool_smoke',
  'apps.electron.resources.scripts.tests.test_xlsx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_docx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_pptx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_img_tool_smoke',
  'apps.electron.resources.scripts.tests.test_ical_tool_smoke',
  'apps.electron.resources.scripts.tests.test_doc_diff_smoke',
  'apps.electron.resources.scripts.tests.test_markitdown_smoke',
]

const result = Bun.spawnSync([python, '-m', 'unittest', ...modules], {
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(result.exitCode)
