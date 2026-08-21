import { motion } from 'framer-motion';

export default function EmptyState({ icon, title, subtitle, action, onAction }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex flex-col items-center justify-center py-16 px-8 text-center rounded-2xl"
      style={{ border: '1.5px dashed var(--accent-border)', background: 'linear-gradient(135deg, var(--accent-soft-2) 0%, var(--surface-1) 100%)' }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--accent-soft-3) 100%)', boxShadow: 'var(--shadow-md)' }}
      >
        {icon}
      </div>
      <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 6 }}>{title}</p>
      {subtitle && <p style={{ fontSize: 13, color: 'var(--ink-5)', maxWidth: 300, lineHeight: 1.5, marginBottom: action ? 20 : 0 }}>{subtitle}</p>}
      {action && (
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onAction}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-on-solid"
          style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)', boxShadow: 'var(--shadow-md)' }}
        >
          {action}
        </motion.button>
      )}
    </motion.div>
  );
}
