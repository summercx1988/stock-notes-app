import { NotesService } from '../services/notes'
import { marketDataService } from '../services/market-data'
import { NotesAppService } from './notes-app-service'

export const sharedNotesService = new NotesService()

export const notesAppService = new NotesAppService(sharedNotesService, marketDataService)
