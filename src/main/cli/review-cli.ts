import { NotesService } from '../services/notes'
import { MarketDataService } from '../services/market-data'
import { NotesAppService } from '../application/notes-app-service'
import type { KlineInterval, ReviewScope } from '../../shared/types'

interface CliArgs {
  mode: 'evaluate' | 'snapshot'
  scope: ReviewScope
  stockCode?: string
  startDate?: string
  endDate?: string
  interval: KlineInterval
}

function parseArgs(argv: string[]): CliArgs {
  const args: Record<string, string> = {}

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = value
    i += 1
  }

  const scope = args.scope === 'single' ? 'single' : 'overall'
  const interval = (args.interval || '5m') as KlineInterval
  const mode = args.mode === 'snapshot' ? 'snapshot' : 'evaluate'

  return {
    mode,
    scope,
    stockCode: args.stock,
    startDate: args.start,
    endDate: args.end,
    interval
  }
}

function printUsage(): void {
  console.log('Usage:')
  console.log('  npm run cli:review -- --mode evaluate --scope single --stock 600519 --start 2026-03-01T09:30:00+08:00 --end 2026-03-24T15:00:00+08:00 --interval 5m')
  console.log('  npm run cli:review -- --mode evaluate --scope overall --start 2026-03-01T00:00:00+08:00 --end 2026-03-24T23:59:59+08:00')
  console.log('  npm run cli:review -- --mode snapshot --scope overall --start 2026-03-01T00:00:00+08:00 --end 2026-03-24T23:59:59+08:00')
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (process.argv.includes('--help')) {
    printUsage()
    return
  }

  if (args.scope === 'single' && !args.stockCode) {
    throw new Error('single scope requires --stock <stockCode>')
  }

  const service = new NotesAppService(new NotesService(), new MarketDataService())
  if (args.mode === 'snapshot') {
    const snapshot = await service.getReviewSnapshot({
      scope: args.scope,
      stockCode: args.stockCode,
      startDate: args.startDate,
      endDate: args.endDate,
      interval: args.interval
    })
    console.log(JSON.stringify(snapshot, null, 2))
    return
  }

  const evaluation = await service.getReviewEvaluation({
    scope: args.scope,
    stockCode: args.stockCode,
    startDate: args.startDate,
    endDate: args.endDate,
    interval: args.interval,
    rule: {
      windowDays: 3,
      thresholdPct: 3,
      excludeUnknown: true
    }
  })
  console.log(JSON.stringify(evaluation, null, 2))
}

main().catch((error) => {
  console.error('[review-cli] failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
