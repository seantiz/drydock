<script lang="ts">
    import { drydock } from 'services/drydock.svelte'
    import type { UserPlatform, NarrativeStyle, TargetAudience } from 'schema'

    interface Props {
        onComplete?: () => void
        existing?: boolean
    }

    let { onComplete, existing = false }: Props = $props()

    let platform = $state<UserPlatform>(drydock.creator?.mainPlatform || 'blog')
    let voice = $state<NarrativeStyle>(drydock.creator?.voice || 'chronicle')
    let audience = $state<TargetAudience>(drydock.creator?.audience || 'technical')
    let activeTemplates = $state<UserPlatform[]>(drydock.creator?.platforms || ['blog'])
    let saving = $state(false)

    async function submit() {
        saving = true
        try {
            const safeDefault: UserPlatform[] =
                activeTemplates.length > 0 ? activeTemplates : ['blog']
            await drydock.niceToMeetUser(platform, voice, audience, safeDefault)
            onComplete?.()
        } catch (error) {
            console.error('Failed to save user profile:', error)
        } finally {
            saving = false
        }
    }

    function enableTemplate(template: UserPlatform) {
        if (activeTemplates.includes(template)) {
            activeTemplates = activeTemplates.filter((t) => t !== template)
        } else {
            activeTemplates = [...activeTemplates, template]
        }
    }
</script>

<div class="profile-form">
    <div class="section-header">
        <h2>{existing ? 'Change of style?' : 'Tell us about yourself'}</h2>
        <p>This helps us give you better guidance all around.</p>
    </div>

    <div class="form-group">
        <label for="platform">Where do you mainly publish?</label>
        <select id="platform" bind:value={platform}>
            <option value="blog">Blog (long-form, 1 month cycle)</option>
            <option value="bluesky">Bluesky (threads, 2 week cycle)</option>
            <option value="instagram">Instagram (visual, 1 week cycle)</option>
            <option value="linkedin">LinkedIn (professional, 2 week cycle)</option>
        </select>
    </div>

    <div class="form-group">
        <label for="voice">What's your narrative style?</label>
        <select id="voice" bind:value={voice}>
            <option value="chronicle">Chronicle (Gleick style)</option>
            <option value="reckoning">Reckoning (Outcome-based style)</option>
            <option value="witness">Witness (Science report style)</option>
        </select>
        <span class="form-hint">
            {#if voice === 'chronicle'}
                You tell discovery stories that evolve over time
            {:else if voice === 'reckoning'}
                You present opposing viewpoints and the outcome
            {:else}
                You report on data from direct observation
            {/if}
        </span>
    </div>

    <div class="form-group">
        <label for="audience">Who are you writing for?</label>
        <select id="audience" bind:value={audience}>
            <option value="technical">Technical (devs, engineers, deep technical)</option>
            <option value="general">General (accessible, broad audience)</option>
            <option value="hottakes">Hot Takes (fast, opinionated, trending)</option>
            <option value="evergreen">Evergreen (timeless, reference material)</option>
        </select>
    </div>

    <div class="form-group">
        <label>What formats do you want to generate?</label>
        <div class="format-checkboxes">
            <label class="checkbox-label">
                <input
                    type="checkbox"
                    checked={activeTemplates.includes('blog')}
                    onchange={() => enableTemplate('blog')}
                />
                <span>Blog Posts</span>
            </label>
            <label class="checkbox-label">
                <input
                    type="checkbox"
                    checked={activeTemplates.includes('bluesky')}
                    onchange={() => enableTemplate('bluesky')}
                />
                <span>Bluesky (threads)</span>
            </label>
            <label class="checkbox-label">
                <input
                    type="checkbox"
                    checked={activeTemplates.includes('instagram')}
                    onchange={() => enableTemplate('instagram')}
                />
                <span>Instagram Posts</span>
            </label>
        </div>
    </div>

    <button class="btn-primary" onclick={submit} disabled={saving}>
        {saving ? 'Saving...' : existing ? 'Update Profile' : 'Get Started'}
    </button>
</div>

<style>
    .profile-form {
        max-width: 500px;
        margin: 0 auto;
        padding: 32px;
    }
</style>
