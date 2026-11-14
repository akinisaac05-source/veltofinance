import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceFiles = [
  'contracts/src/interfaces/IMUSDSavingsRate.sol',
  'contracts/src/PrincipalToken.sol',
  'contracts/src/YieldToken.sol',
  'contracts/src/YieldExchange.sol',
  'contracts/src/YieldMarket.sol',
]
const sources = Object.fromEntries(
  sourceFiles.map((file) => [file, { content: readFileSync(path.join(projectRoot, file), 'utf8') }]),
)
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (specifier) => {
      for (const root of [projectRoot, path.join(projectRoot, 'node_modules')]) {
        const candidate = path.join(root, specifier)
        if (existsSync(candidate)) return { contents: readFileSync(candidate, 'utf8') }
      }
      return { error: `Import not found: ${specifier}` }
    },
  }),
)

const errors = (output.errors ?? []).filter((diagnostic) => diagnostic.severity === 'error')
if (errors.length > 0) {
  for (const diagnostic of errors) console.error(diagnostic.formattedMessage)
  process.exit(1)
}

const artifacts = {}
for (const [source, name] of [
  ['contracts/src/YieldExchange.sol', 'YieldExchange'],
  ['contracts/src/YieldMarket.sol', 'YieldMarket'],
]) {
  const contract = output.contracts[source][name]
  artifacts[name] = {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
  }
}

writeFileSync(
  path.join(projectRoot, 'lib/deployment-artifacts.json'),
  `${JSON.stringify(artifacts)}\n`,
)
console.log(`Generated wallet-deployment artifacts for ${Object.keys(artifacts).join(', ')}`)
