#!/usr/bin/env node

/**
 * lucidity — transcript capture
 *
 * watches an agentchat message stream and appends to the transcript log.
 * designed to be called from the agent's listen loop:
 *
 *   const capture = createCapture(store, 'god');
 *   // in listen loop:
 *   capture.record(messages);       // from agentchat_listen response
 *   capture.recordSent(target, msg); // when agent sends
 *
 * the transcript format is simple timestamped lines.
 * the curator reads these later for summarization.
 */

const { createStore } = require('./store.js');

function createCapture(store, agentName) {
  let messageCount = 0;
  let lastCaptureAt = null;

  return {
    /**
     * record incoming messages from agentchat_listen.
     * messages: array of { from, from_name, to, content, ts }
     */
    record(messages) {
      if (!messages || messages.length === 0) return 0;

      let recorded = 0;
      for (const msg of messages) {
        // skip our own messages (avoid echo)
        if (msg.from_name === agentName) continue;

        const sender = msg.from_name || msg.from || 'unknown';
        const target = msg.to || '#unknown';
        const line = `${target} <${sender}> ${msg.content}`;
        store.appendTranscript(agentName, line);
        recorded++;
      }

      messageCount += recorded;
      if (recorded > 0) lastCaptureAt = new Date().toISOString();
      return recorded;
    },

    /**
     * record a message sent by this agent.
     */
    recordSent(target, content) {
      const line = `${target} <${agentName}> ${content}`;
      store.appendTranscript(agentName, line);
      messageCount++;
      lastCaptureAt = new Date().toISOString();
    },

    /**
     * record a system event (restart, error, etc).
     */
    recordEvent(event) {
      store.appendTranscript(agentName, `[event] ${event}`);
    },

    /**
     * get capture stats.
     */
    stats() {
      return {
        agentName,
        messageCount,
        lastCaptureAt,
      };
    },
  };
}

module.exports = { createCapture };
