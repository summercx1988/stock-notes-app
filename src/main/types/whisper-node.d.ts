declare module 'whisper-node' {
  interface ITranscriptLine {
    start: string
    end: string
    speech: string
  }

  interface IFlagTypes {
    language?: string
    gen_file_txt?: boolean
    gen_file_subtitle?: boolean
    gen_file_vtt?: boolean
    word_timestamps?: boolean
    timestamp_size?: number
  }

  interface IOptions {
    modelName?: string
    modelPath?: string
    whisperOptions?: IFlagTypes
  }

  function whisper(filePath: string, options?: IOptions): Promise<ITranscriptLine[]>
  
  export default whisper
}
