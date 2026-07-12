export function createDefaultRecipeTemplate(name: string): string {
  return `description: ${name} recipe

arguments:
  - name: input
    description: Path or topic for this recipe
    type: string

steps:
  - task: |
      Work on $INPUT.

      Make one focused change and stop when the requested work is complete.

  - tasks:
      - |
        Review the changes for $INPUT.
        Report concrete findings only.
      - |
        Fix the review findings for $INPUT.
    repeat: 2
`;
}
