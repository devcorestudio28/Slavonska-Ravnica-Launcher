import React, { useEffect, useState } from 'react'
import { useAuthStore } from './store/auth.store'
import { useLogStore } from './store/log.store'
import { useDownloadStore } from './store/download.store'
import { useUploadStore } from './store/upload.store'
import DiscordLogin from './components/auth/DiscordLogin'
import AccessDenied from './components/auth/AccessDenied'
import Layout from './components/layout/Layout'
import logoUrl from './assets/logo.png'
import type { LogEntry, DownloadItem, DownloadProgress, UploadItem } from '../../../shared/types'

export type Page = 'servers' | 'dashboard' | 'mods' | 'settings' | 'admin' | 'logs'

export default function App(): React.ReactElement {
  const { isAuthenticated, hasRequiredRole, isLoading, checkSession } = useAuthStore()
  const { addLog } = useLogStore()
  const { updateProgress, setQueue } = useDownloadStore()
  const { setQueue: setUploadQueue, updateItem: updateUploadItem } = useUploadStore()
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')

  // Boot: check existing session
  useEffect(() => {
    checkSession()
  }, [])

  // Subscribe to IPC events
  useEffect(() => {
    const onLog = (entry: LogEntry): void => addLog(entry)
    const onProgress = (progress: DownloadProgress): void => updateProgress(progress)
    const onQueueUpdate = (queue: DownloadItem[]): void => setQueue(queue)
    const onUploadQueue = (queue: UploadItem[]): void => setUploadQueue(queue)
    const onUploadProgress = (item: UploadItem): void => updateUploadItem(item)

    window.electron.on('log:new-entry', onLog as never)
    window.electron.on('download:progress', onProgress as never)
    window.electron.on('download:queue-update', onQueueUpdate as never)
    window.electron.on('upload:queue-update', onUploadQueue as never)
    window.electron.on('upload:progress', onUploadProgress as never)

    return () => {
      window.electron.off('log:new-entry', onLog as never)
      window.electron.off('download:progress', onProgress as never)
      window.electron.off('download:queue-update', onQueueUpdate as never)
      window.electron.off('upload:queue-update', onUploadQueue as never)
      window.electron.off('upload:progress', onUploadProgress as never)
    }
  }, [])

  // Loading screen
  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-dark flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-2 border-dark-400 border-t-gold animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <img src={logoUrl} alt="SR" className="w-11 h-11 object-contain animate-pulse" />
          </div>
        </div>
        <div className="text-center">
          <div className="text-gold font-bold text-2xl tracking-widest mb-1">SR LAUNCHER</div>
          <div className="text-gray-500 text-sm">Učitavanje...</div>
        </div>
      </div>
    )
  }

  // Not authenticated
  if (!isAuthenticated) {
    return <DiscordLogin />
  }

  // Authenticated but no role
  if (!hasRequiredRole) {
    return <AccessDenied />
  }

  return (
    <Layout currentPage={currentPage} setCurrentPage={setCurrentPage} />
  )
}
