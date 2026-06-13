import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useState } from 'react';
import type { QuorumConfig } from '../../config/schema.ts';
import { PipelinesTab, togglePipelineExpand } from './pipelines-tab.tsx';
import { ReviewsTab } from './reviews-tab.tsx';
import type { PipelineSummary, ReviewRecord } from './utils.ts';
import { extractPipelines, loadReviews } from './utils.ts';

interface Props {
  config: QuorumConfig;
  root: string;
}

type Tab = 'pipelines' | 'reviews';
type View = 'list' | 'detail';
type DetailContent =
  | { type: 'pipeline'; item: PipelineSummary }
  | { type: 'review'; item: ReviewRecord };

export function Dashboard({ config, root }: Props) {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>('pipelines');
  const [view, setView] = useState<View>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<DetailContent | null>(null);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const pipelines = extractPipelines(config);

  useEffect(() => {
    loadReviews(root).then((r) => {
      setReviews(r);
      setLoading(false);
    });
  }, [root]);

  const items = tab === 'pipelines' ? pipelines : reviews;

  useInput((_input, key) => {
    if (_input === 'q' || key.escape) {
      if (view === 'detail') {
        setView('list');
        setDetail(null);
        return;
      }
      exit();
      return;
    }

    if (view === 'detail') {
      if (key.return || key.escape) {
        setView('list');
        setDetail(null);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
      return;
    }

    if (tab === 'pipelines' && key.return) {
      setExpanded((prev) => togglePipelineExpand(prev, selectedIndex));
      return;
    }

    if (tab === 'reviews' && key.return) {
      const r = reviews[selectedIndex];
      if (r) {
        setDetail({ type: 'review', item: r });
        setView('detail');
      }
      return;
    }

    if (key.rightArrow || key.tab) {
      const next = tab === 'pipelines' ? 'reviews' : 'pipelines';
      setTab(next);
      setSelectedIndex(0);
      return;
    }

    if (key.leftArrow) {
      const prev = tab === 'reviews' ? 'pipelines' : 'reviews';
      setTab(prev);
      setSelectedIndex(0);
      return;
    }
  });

  if (view === 'detail' && detail?.type === 'review' && detail.item.content) {
    return (
      <ReviewDetailView
        record={detail.item}
        onBack={() => {
          setView('list');
          setDetail(null);
        }}
      />
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Header tab={tab} />
      <Box flexDirection="column" flexGrow={1}>
        {tab === 'pipelines' ? (
          <PipelinesTab
            pipelines={pipelines}
            selectedIndex={selectedIndex}
            expanded={expanded}
          />
        ) : loading ? (
          <Box paddingX={2} paddingY={1}>
            <Text dimColor>Loading reviews...</Text>
          </Box>
        ) : (
          <ReviewsTab reviews={reviews} selectedIndex={selectedIndex} />
        )}
      </Box>
      <Footer />
    </Box>
  );
}

function Header({ tab }: { tab: Tab }) {
  return (
    <Box
      borderStyle="round"
      borderColor="green"
      paddingX={2}
      paddingY={0}
      justifyContent="space-between"
    >
      <Box gap={3}>
        <TabLabel label="Pipelines" active={tab === 'pipelines'} />
        <TabLabel label="Reviews" active={tab === 'reviews'} />
      </Box>
      <Text dimColor>quorum dashboard</Text>
    </Box>
  );
}

function TabLabel({ label, active }: { label: string; active: boolean }) {
  return (
    <Text bold={active} color={active ? 'green' : 'dim'}>
      {active ? '● ' : '○ '}
      {label}
    </Text>
  );
}

function Footer() {
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={2}
      paddingY={0}
      gap={2}
    >
      <Text dimColor>↑↓ navigate</Text>
      <Text dimColor>↹ tab</Text>
      <Text dimColor>⏎ expand/detail</Text>
      <Text dimColor>Esc back</Text>
      <Text color="red">q quit</Text>
    </Box>
  );
}

function ReviewDetailView({
  record,
  onBack,
}: {
  record: ReviewRecord;
  onBack: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });

  const content = record.content ?? '';

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="blue" paddingX={2} paddingY={0}>
        <Text bold>{record.pipelineId}</Text>
        <Text dimColor> {record.timestamp.toLocaleString()}</Text>
        <Text dimColor> {record.kind}</Text>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1} flexGrow={1}>
        <Text wrap="wrap">{content}</Text>
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={2} paddingY={0}>
        <Text dimColor>↑↓ scroll </Text>
        <Text color="cyan">Esc/⏎ back</Text>
      </Box>
    </Box>
  );
}
