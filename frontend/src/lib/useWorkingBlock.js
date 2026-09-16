import { useEffect } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { useBlock } from '../context/AppContext';
import { resolveBlock } from './blockNavigation';

export function useWorkingBlock() {
  const workspace = useOutletContext();
  const { blockNumber } = useParams();
  const [search] = useSearchParams();
  const context = useBlock();
  const { academicYears, currentBlock, currentAcademicYear, setCurrentBlock, setCurrentAcademicYear } = context;
  const block = workspace?.block ?? resolveBlock({ blockNumber, blockId: search.get('blockId'), academicYears, currentBlock, currentAcademicYear });

  useEffect(() => {
    if (workspace || !block) return;
    if (block.id !== currentBlock?.id) setCurrentBlock(block);
    const year = academicYears.find(item => item.blocks.some(candidate => candidate.id === block.id));
    if (year && year.id !== currentAcademicYear?.id) setCurrentAcademicYear(year);
  }, [workspace, block, currentBlock?.id, currentAcademicYear?.id, academicYears, setCurrentBlock, setCurrentAcademicYear]);

  return block;
}
