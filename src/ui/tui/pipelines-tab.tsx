import { Box, Text } from 'ink';
import type { PipelineSummary } from './utils.ts';

interface Props {
  pipelines: PipelineSummary[];
  selectedIndex: number;
  expanded: Set<number>;
}

export function PipelinesTab({ pipelines, selectedIndex, expanded }: Props) {
  if (pipelines.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor>No pipelines configured in quorum.yaml</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold underline>
          Pipelines
        </Text>
      </Box>

      {pipelines.map((p, i) => {
        const isSelected = i === selectedIndex;
        const isExpanded = expanded.has(i);
        const borderChar = isSelected ? '▎' : ' ';
        const indent = p.id.length + 4;

        return (
          <Box key={p.id} flexDirection="column">
            <Box>
              {isSelected ? (
                <Text color="cyan">
                  <Text bold>{borderChar}</Text> <Text bold>{p.id}</Text>
                  <Text dimColor> — </Text>
                  <Text>{p.mode}</Text>
                  <Text dimColor> · </Text>
                  <Text dimColor>
                    {p.reviewerCount} reviewer{p.reviewerCount !== 1 ? 's' : ''}
                  </Text>
                  {p.consensus ? (
                    <>
                      <Text dimColor> · </Text>
                      <Text color="yellow">{p.consensus}</Text>
                    </>
                  ) : null}
                </Text>
              ) : (
                <Text>
                  <Text bold>{borderChar}</Text> <Text>{p.id}</Text>
                  <Text dimColor> — </Text>
                  <Text>{p.mode}</Text>
                  <Text dimColor> · </Text>
                  <Text dimColor>
                    {p.reviewerCount} reviewer{p.reviewerCount !== 1 ? 's' : ''}
                  </Text>
                  {p.consensus ? (
                    <>
                      <Text dimColor> · </Text>
                      <Text color="yellow">{p.consensus}</Text>
                    </>
                  ) : null}
                </Text>
              )}
            </Box>

            {isExpanded ? (
              <Box
                flexDirection="column"
                paddingLeft={indent + 2}
                marginTop={0}
              >
                {p.reviewers.map((r) => (
                  <Box key={r.id}>
                    <Text>
                      <Text color="green">•</Text> <Text bold>{r.id}</Text>
                      <Text dimColor> persona=</Text>
                      <Text>{r.persona}</Text>
                      <Text dimColor> provider=</Text>
                      <Text>{r.provider}</Text>
                      {r.model ? (
                        <>
                          <Text dimColor> model=</Text>
                          <Text>{r.model}</Text>
                        </>
                      ) : null}
                    </Text>
                  </Box>
                ))}
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

export function togglePipelineExpand(
  expanded: Set<number>,
  index: number,
): Set<number> {
  const next = new Set(expanded);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}
