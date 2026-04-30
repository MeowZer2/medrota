import { motion } from 'framer-motion';

export default function EmptyState({ icon, title, subtitle, action, onAction }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex flex-col items-center justify-center py-16 px-8 text-center rounded-2xl"
      style={{ border: '1.5px dashed #D6E4F7', background: 'linear-gradient(135deg, #F8FBFF 0%, #ffffff 100%)' }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'linear-gradient(135deg, #EEF4FF 0%, #E0ECFF 100%)', boxShadow: '0 4px 16px rgba(44,95,138,0.1)' }}
      >
        {icon}
      </div>
      <p style={{ fontSize: 16, fontWeight: 700, color: '#1A3A5C', marginBottom: 6 }}>{title}</p>
      {subtitle && <p style={{ fontSize: 13, color: '#94A3B8', maxWidth: 300, lineHeight: 1.5, marginBottom: action ? 20 : 0 }}>{subtitle}</p>}
      {action && (
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onAction}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)', boxShadow: '0 4px 12px rgba(26,58,92,0.2)' }}
        >
          {action}
        </motion.button>
      )}
    </motion.div>
  );
}
