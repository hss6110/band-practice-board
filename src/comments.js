import { supabase } from './supabase.js'

const COMMENTS_PAGE_SIZE = 5
const commentVisibleCounts = new Map()

const COMMENT_TARGETS = {
  practice: {
    table: 'practice_log_comments',
    foreignKey: 'practice_log_id',
    label: '연습 기록'
  },
  recommendation: {
    table: 'song_recommendation_comments',
    foreignKey: 'recommendation_id',
    label: '추천곡'
  }
}

function getCommentTarget(targetType) {
  const target = COMMENT_TARGETS[targetType]

  if (!target) {
    throw new Error('지원하지 않는 댓글 대상입니다.')
  }

  return target
}

function formatCommentDate(dateValue) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateValue))
}

export async function loadComments(targetType, targetIds) {
  const target = getCommentTarget(targetType)
  const uniqueTargetIds = [...new Set(targetIds)]

  if (uniqueTargetIds.length === 0) {
    return {
      data: [],
      error: null
    }
  }

  const { data, error } = await supabase
    .from(target.table)
    .select(`
      id,
      ${target.foreignKey},
      content,
      created_by,
      created_at
    `)
    .in(target.foreignKey, uniqueTargetIds)
    .order('created_at', { ascending: true })

  return {
    data: data ?? [],
    error
  }
}

export function groupCommentsByTarget(
  comments,
  foreignKey
) {
  const commentsByTarget = new Map()

  comments.forEach((comment) => {
    const targetId = comment[foreignKey]
    const targetComments =
      commentsByTarget.get(targetId) ?? []

    targetComments.push(comment)
    commentsByTarget.set(targetId, targetComments)
  })

  return commentsByTarget
}

export function captureCommentDrafts(container) {
  const drafts = new Map()

  container
    ?.querySelectorAll('[data-comment-draft-key]')
    .forEach((input) => {
      if (input.value) {
        drafts.set(input.dataset.commentDraftKey, input.value)
      }
    })

  return drafts
}

export function getCommentDraftKey(targetType, targetId) {
  return `${targetType}:${targetId}`
}

export function createCommentsSection({
  targetType,
  targetId,
  comments,
  membersByUserId,
  currentUserId,
  isAdmin,
  initialDraft = ''
}) {
  const target = getCommentTarget(targetType)
  const commentStateKey = getCommentDraftKey(
    targetType,
    targetId
  )
  const section = document.createElement('section')
  section.className = 'comments-section'

  const header = document.createElement('div')
  header.className = 'comments-header'

  const title = document.createElement('strong')
  title.className = 'comments-title'

  const list = document.createElement('div')
  list.className = 'comments-list'

  const form = document.createElement('form')
  form.className = 'comment-form'

  const input = document.createElement('textarea')
  input.className = 'comment-input'
  input.rows = 2
  input.maxLength = 1000
  input.placeholder = '댓글을 입력하세요.'
  input.setAttribute(
    'aria-label',
    `${target.label} 댓글 입력`
  )
  input.dataset.commentDraftKey = getCommentDraftKey(
    targetType,
    targetId
  )
  input.value = initialDraft

  const submitButton = document.createElement('button')
  submitButton.className = 'comment-submit-button'
  submitButton.type = 'submit'
  submitButton.textContent = '등록'

  const message = document.createElement('p')
  message.className = 'comment-form-message'
  message.setAttribute('aria-live', 'polite')

  let currentComments = comments
  let visibleCommentCount =
    commentVisibleCounts.get(commentStateKey) ??
    COMMENTS_PAGE_SIZE

  function showMessage(text, isError = false) {
    message.textContent = text
    message.classList.toggle('error-message', isError)
  }

  async function refreshComments() {
    const result = await loadComments(targetType, [targetId])

    if (!section.isConnected) {
      return
    }

    if (result.error) {
      console.error(result.error)
      showMessage(
        `댓글 조회 실패: ${result.error.message}`,
        true
      )
      return
    }

    currentComments = result.data
    renderCommentList()
  }

  function renderCommentList() {
    title.textContent = `댓글 ${currentComments.length}`
    list.replaceChildren()

    if (currentComments.length === 0) {
      visibleCommentCount = COMMENTS_PAGE_SIZE
      commentVisibleCounts.delete(commentStateKey)

      const emptyMessage = document.createElement('p')
      emptyMessage.className = 'comments-empty-message'
      emptyMessage.textContent = '아직 댓글이 없습니다.'
      list.append(emptyMessage)
      return
    }

    const visibleComments = currentComments.slice(
      -visibleCommentCount
    )
    const hiddenCommentCount =
      currentComments.length - visibleComments.length

    if (hiddenCommentCount > 0) {
      const loadMoreButton = document.createElement('button')
      const nextCommentCount = Math.min(
        COMMENTS_PAGE_SIZE,
        hiddenCommentCount
      )

      loadMoreButton.className =
        'comments-load-more-button'
      loadMoreButton.type = 'button'
      loadMoreButton.textContent =
        `이전 댓글 ${nextCommentCount}개 더보기`
      loadMoreButton.addEventListener('click', () => {
        visibleCommentCount += COMMENTS_PAGE_SIZE
        commentVisibleCounts.set(
          commentStateKey,
          visibleCommentCount
        )
        renderCommentList()
      })

      list.append(loadMoreButton)
    }

    const fragment = document.createDocumentFragment()

    visibleComments.forEach((comment) => {
      const item = document.createElement('div')
      item.className = 'comment-item'

      const itemHeader = document.createElement('div')
      itemHeader.className = 'comment-item-header'

      const author = membersByUserId.get(
        comment.created_by
      )

      const meta = document.createElement('span')
      meta.className = 'comment-meta'
      meta.textContent =
        `${author?.display_name ?? '밴드원'} · ` +
        formatCommentDate(comment.created_at)

      itemHeader.append(meta)

      const canDelete =
        isAdmin || comment.created_by === currentUserId

      if (canDelete) {
        const deleteButton = document.createElement('button')
        deleteButton.className = 'comment-delete-button'
        deleteButton.type = 'button'
        deleteButton.textContent = '삭제'
        deleteButton.addEventListener('click', async () => {
          const confirmed = window.confirm(
            '이 댓글을 삭제할까요?'
          )

          if (!confirmed) {
            return
          }

          deleteButton.disabled = true

          const { error } = await supabase
            .from(target.table)
            .delete()
            .eq('id', comment.id)

          if (error) {
            console.error(error)
            showMessage(
              `댓글 삭제 실패: ${error.message}`,
              true
            )
            deleteButton.disabled = false
            return
          }

          showMessage('댓글이 삭제됐습니다.')
          await refreshComments()
        })

        itemHeader.append(deleteButton)
      }

      const content = document.createElement('p')
      content.className = 'comment-content'
      content.textContent = comment.content

      item.append(itemHeader, content)
      fragment.append(item)
    })

    list.append(fragment)
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    const content = input.value.trim()

    if (!content) {
      showMessage('댓글 내용을 입력해주세요.', true)
      input.focus()
      return
    }

    submitButton.disabled = true
    input.disabled = true
    showMessage('등록하고 있습니다.')

    const originalInput = input.value
    input.value = ''

    const { error } = await supabase
      .from(target.table)
      .insert({
        [target.foreignKey]: targetId,
        content,
        created_by: currentUserId
      })

    if (error) {
      console.error(error)

      if (!section.isConnected) {
        return
      }

      input.value = originalInput
      input.disabled = false
      showMessage(
        `댓글 등록 실패: ${error.message}`,
        true
      )
      submitButton.disabled = false
      return
    }

    if (!section.isConnected) {
      return
    }

    input.disabled = false
    submitButton.disabled = false
    showMessage('댓글이 등록됐습니다.')
    await refreshComments()
  })

  header.append(title)
  form.append(input, submitButton)
  section.append(header, list, form, message)
  renderCommentList()

  return section
}
