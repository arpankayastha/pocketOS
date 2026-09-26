import { createContext, useContext } from 'react'

// In-app replacements for window.confirm / prompt / alert. Each returns a promise:
//   await dialog.confirm({ title, message, confirmLabel, danger })  → true | false
//   await dialog.prompt({ title, label, defaultValue, confirmLabel }) → string | null
//   await dialog.alert({ title, message })                           → undefined
// Provided by <DialogProvider> (components/DialogProvider.jsx) around the app.
export const DialogContext = createContext(null)
export const useDialog = () => useContext(DialogContext)
