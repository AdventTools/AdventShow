
import { useState } from 'react';

export function ImportPage() {
  const [status, setStatus] = useState<'idle' | 'importing' | 'completed' | 'error'>('idle');
  const [result, setResult] = useState<{ success: number, failed: number, errors: string[] } | null>(null);
  const [folderPath, setFolderPath] = useState<string>('');

  const handleSelectFolder = async () => {
    try {
      const path = await window.electron.dialog.selectFolder();
      if (path) {
        setFolderPath(path);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleImport = async () => {
    if (!folderPath) return;
    setStatus('importing');
    try {
      const res = await window.electron.db.importPresentations(folderPath);
      setResult(res);
      setStatus('completed');
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Import Hymns</h1>
      
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select PowerPoint Folder
          </label>
          <div className="flex gap-4">
            <button
              onClick={handleSelectFolder}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
              disabled={status === 'importing'}
            >
              Browse Folder
            </button>
            <div className="flex-1 p-2 bg-gray-100 rounded border border-gray-300 truncate">
              {folderPath || <span className="text-gray-400">No folder selected</span>}
            </div>
          </div>
        </div>

        {folderPath && status !== 'importing' && status !== 'completed' && (
          <button
            onClick={handleImport}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition"
          >
            Start Import
          </button>
        )}

        {status === 'importing' && (
          <div className="text-center py-8">
            <div className="text-blue-600 font-semibold mb-2">Importing...</div>
            <p className="text-sm text-gray-500">Please wait while we process your files.</p>
          </div>
        )}

        {status === 'completed' && result && (
          <div className="mt-6">
            <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">Import Completed</h3>
                  <div className="mt-2 text-sm text-green-700">
                    <p>Successfully imported: {result.success}</p>
                    <p>Failed: {result.failed}</p>
                  </div>
                </div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-red-800 mb-2">Errors:</h4>
                <div className="bg-red-50 border border-red-200 rounded-md p-4 max-h-40 overflow-y-auto">
                  <ul className="list-disc pl-5 space-y-1">
                    {result.errors.map((err, idx) => (
                      <li key={idx} className="text-xs text-red-700 break-words">{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
             <button
              onClick={() => setStatus('idle')}
              className="mt-4 text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              Import More
            </button>
          </div>
        )}

         {status === 'error' && (
             <div className="mt-6 bg-red-50 border border-red-200 rounded-md p-4 text-red-700">
                 An unexpected error occurred during import.
             </div>
         )}
      </div>
    </div>
  );
}
