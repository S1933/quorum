import { Box, Text } from 'ink';
import type { ReviewRecord } from './utils.ts';

interface Props {
  reviews: ReviewRecord[];
  selectedIndex: number;
}

function sevColor(sev: string): string {
  switch (sev) {
    case 'Critical':
      return 'red';
    case 'High':
      return 'red';
    case 'Medium':
      return 'yellow';
    case 'Low':
      return 'blue';
    case 'Info':
      return 'green';
    default:
      return 'white';
  }
}

export function ReviewsTab({ reviews, selectedIndex }: Props) {
  if (reviews.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor>No reviews found in .quorum/reviews/</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold underline>
          Review History
        </Text>
      </Box>

      {reviews.map((r, i) => {
        const isSelected = i === selectedIndex;
        const borderChar = isSelected ? '▎' : ' ';
        const ts = r.timestamp;
        const dateStr = `${String(ts.getMonth() + 1).padStart(2, '0')}/${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;

        return (
          <Box key={r.path} flexDirection="column">
            <Box>
              {isSelected ? (
                <Text color="cyan">
                  <Text bold>{borderChar}</Text>{' '}
                  <Text color="blue">{dateStr}</Text>
                  <Text dimColor> </Text>
                  <Text bold>{r.pipelineId}</Text>
                </Text>
              ) : (
                <Text>
                  <Text bold>{borderChar}</Text>{' '}
                  <Text color="blue">{dateStr}</Text>
                  <Text dimColor> </Text>
                  <Text>{r.pipelineId}</Text>
                </Text>
              )}
            </Box>

            {r.summary ? (
              <Box paddingLeft={4}>
                <Text dimColor>
                  <Text>{r.summary.reviewerCount} rev</Text>
                  <Text> · {r.summary.findingCount} findings</Text>
                  {r.summary.errorCount > 0 ? (
                    <Text color="red"> · {r.summary.errorCount} errors</Text>
                  ) : null}
                  {r.summary.duration ? (
                    <Text> · {r.summary.duration}s</Text>
                  ) : null}
                </Text>
                {Object.keys(r.summary.severity).length > 0 ? (
                  <Box paddingLeft={2} gap={1}>
                    {Object.entries(r.summary.severity).map(([sev, count]) =>
                      count > 0 ? (
                        <Text key={sev} color={sevColor(sev)}>
                          {sev[0]}
                          {count}
                        </Text>
                      ) : null,
                    )}
                  </Box>
                ) : null}
              </Box>
            ) : (
              <Box paddingLeft={4}>
                <Text dimColor>parsing failed</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
