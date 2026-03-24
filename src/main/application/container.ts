import { NotesService } from '../services/notes'
import { NotesAppService } from './notes-app-service'

const notesService = new NotesService()

export const notesAppService = new NotesAppService(notesService)
