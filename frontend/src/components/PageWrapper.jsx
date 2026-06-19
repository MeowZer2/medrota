import { motion } from 'framer-motion';

const variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.14, ease: 'easeOut' } },
  exit:    { opacity: 0, y: -2, transition: { duration: 0.08, ease: 'easeIn' } },
};

export default function PageWrapper({ children }) {
  return (
    <motion.div variants={variants} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  );
}
