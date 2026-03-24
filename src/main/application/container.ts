import { NotesService } from '../services/notes'
import { marketDataService } from '../services/market-data'
import { NotesAppService } from './notes-app-service'

const notesService = new NotesService()

export const notesAppService = new NotesAppService(notesService, marketDataService)
