const { Toolkit } = require("actions-toolkit");
const { parse, toSeconds } = require("iso8601-duration");

Toolkit.run(async (tools) => {
  // What time frame are we looking at?
  let duration;
  try {
    duration = toSeconds(parse(tools.inputs.since));
  } catch (e) {
    tools.exit.failure(`Invalid duration provided: ${tools.inputs.since}`);
    return;
  }

  const earliestDate = Math.floor(Date.now() / 1000) - duration;

  let pulls = await tools.github.paginate(
    tools.github.pulls.list,
    {
      ...tools.context.repo,
      state: "closed",
      per_page: 100,
      sort: "updated",
    },
    (response, done) => {
      const pulls = response.data.filter((pr) => {
        const updated = Math.floor(Date.parse(pr.updated_at).valueOf() / 1000);
        return updated > earliestDate;
      });

      if (pulls.length !== response.data.length) {
        done();
      }
      return pulls;
    }
  );

  // Filter to those that have the right labels
  pulls = pulls.filter((pr) => {
    return pr.labels.find((label) => {
      return label.name == "merge-milestone";
    });
  });

  // Group PRs by label
  const milestones = {};
  for (const pr of pulls) {
    const label = pr.labels.find((label) =>
      label.name.startsWith("merge-milestone:")
    );

    if (label) {
      milestones[label.name] = milestones[label.name] || [];
      milestones[label.name].push(pr);
    }
  }

  // Are there any milestones?
  if (!Object.keys(milestones).length) {
    tools.exit.success("No milestones hit");
    return;
  }

  // Build an issue body
  let body = "";
  for (const milestone in milestones) {
    body += `## ${milestone}\n\n`;
    for (const pr of milestones[milestone]) {
      body += `* [${pr.title}](${pr.html_url}) (@${pr.user.login})`;
    }
  }

  // Create an issue
  await tools.github.issues.create({
    ...tools.context.repo,
    title: "Milestone Update",
    body,
  });

  tools.exit.success("Report created");
});
