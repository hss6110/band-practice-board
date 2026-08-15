import { supabase } from './supabase.js'

const COMMENTS_PAGE_SIZE = 5
const RECENT_COMMENTS_LIMIT = 5
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

export async function loadRecentComments(
  targetType,
  limit = RECENT_COMMENTS_LIMIT
) {
  const target = getCommentTarget(targetType)
  const safeLimit = Math.min(
    20,
    Math.max(1, Math.floor(limit))
  )

  const { data, error } = await supabase
    .from(target.table)
    .select(`
      id,
      ${target.foreignKey},
      content,
      created_by,
      created_at
    `)
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  return {
    data: data ?? [],
    error
  }
}

export function renderRecentComments({
  container,
  targetType,
  comments,
  membersByUserId,
  getTargetLabel,
  onSelect,
  error = null
}) {
  if (!container) {
    return
  }

  const target = getCommentTarget(targetType)
  container.replaceChildren()

  if (error) {
    const errorMessage = document.createElement('p')
    errorMessage.className =
      'recent-comments-empty error-message'
    errorMessage.textContent =
      '최근 댓글을 불러오지 못했습니다.'
    container.append(errorMessage)
    return
  }

  if (comments.length === 0) {
    const emptyMessage = document.createElement('p')
    emptyMessage.className = 'recent-comments-empty'
    emptyMessage.textContent = '아직 등록된 댓글이 없습니다.'
    container.append(emptyMessage)
    return
  }

  const fragment = document.createDocumentFragment()

  comments.forEach((comment) => {
    const targetId = comment[target.foreignKey]
    const author = membersByUserId.get(comment.created_by)
    const button = document.createElement('button')
    button.className = 'recent-comment-item'
    button.type = 'button'

    const meta = document.createElement('span')
    meta.className = 'recent-comment-meta'
    meta.textContent =
      `${author?.display_name ?? '밴드원'} · ` +
      formatCommentDate(comment.created_at)

    const content = document.createElement('span')
    content.className = 'recent-comment-content'
    content.textContent = comment.content

    const targetLabel = document.createElement('span')
    targetLabel.className = 'recent-comment-target'
    targetLabel.textContent = `↳ ${getTargetLabel(comment)}`

    button.setAttribute(
      'aria-label',
      `${content.textContent}. ${targetLabel.textContent}로 이동`
    )
    button.addEventListener('click', async () => {
      button.disabled = true

      try {
        await onSelect(targetId)
      } finally {
        if (button.isConnected) {
          button.disabled = false
        }
      }
    })

    button.append(meta, content, targetLabel)
    fragment.append(button)
  })

  container.append(fragment)
}

export function revealCommentTarget(element) {
  if (!element) {
    return false
  }

  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  })
  element.classList.remove('is-comment-target')
  void element.offsetWidth
  element.classList.add('is-comment-target')

  window.setTimeout(() => {
    element.classList.remove('is-comment-target')
  }, 2200)

  return true
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

      const content = document.createElement('p')
      content.className = 'comment-content'
      content.textContent = comment.content

      const canManage =
        isAdmin || comment.created_by === currentUserId

      if (canManage) {
        const actions = document.createElement('div')
        actions.className = 'comment-actions'

        const editButton = document.createElement('button')
        editButton.className = 'comment-edit-button'
        editButton.type = 'button'
        editButton.textContent = '수정'

        const deleteButton = document.createElement('button')
        deleteButton.className = 'comment-delete-button'
        deleteButton.type = 'button'
        deleteButton.textContent = '삭제'

        editButton.addEventListener('click', () => {
          const editForm = document.createElement('form')
          editForm.className = 'comment-edit-form'

          const editInput = document.createElement('textarea')
          editInput.className = 'comment-edit-input'
          editInput.rows = 2
          editInput.maxLength = 1000
          editInput.required = true
          editInput.value = comment.content
          editInput.setAttribute(
            'aria-label',
            `${target.label} 댓글 수정`
          )

          const editActions = document.createElement('div')
          editActions.className = 'comment-edit-actions'

          const saveButton = document.createElement('button')
          saveButton.className = 'comment-edit-save-button'
          saveButton.type = 'submit'
          saveButton.textContent = '저장'

          const cancelButton = document.createElement('button')
          cancelButton.className = 'comment-edit-cancel-button'
          cancelButton.type = 'button'
          cancelButton.textContent = '취소'

          const editMessage = document.createElement('p')
          editMessage.className = 'comment-edit-message'
          editMessage.setAttribute('aria-live', 'polite')

          const closeEditor = () => {
            editForm.remove()
            content.hidden = false
            editButton.disabled = false
            deleteButton.disabled = false
          }

          cancelButton.addEventListener('click', closeEditor)

          editForm.addEventListener(
            'submit',
            async (event) => {
              event.preventDefault()

              const nextContent = editInput.value.trim()

              if (!nextContent) {
                editMessage.textContent =
                  '댓글 내용을 입력해주세요.'
                editMessage.classList.add('error-message')
                editInput.focus()
                return
              }

              saveButton.disabled = true
              cancelButton.disabled = true
              editMessage.textContent = '수정하고 있습니다.'
              editMessage.classList.remove('error-message')

              const { data, error } = await supabase
                .from(target.table)
                .update({ content: nextContent })
                .eq('id', comment.id)
                .select('id')
                .maybeSingle()

              if (!section.isConnected) {
                return
              }

              if (error || !data) {
                console.error(error)
                editMessage.textContent = error
                  ? `댓글 수정 실패: ${error.message}`
                  : '수정할 수 있는 댓글이 아닙니다.'
                editMessage.classList.add('error-message')
                saveButton.disabled = false
                cancelButton.disabled = false
                return
              }

              showMessage('댓글이 수정됐습니다.')
              await refreshComments()
            }
          )

          editActions.append(saveButton, cancelButton)
          editForm.append(editInput, editActions, editMessage)
          content.hidden = true
          editButton.disabled = true
          deleteButton.disabled = true
          item.append(editForm)
          editInput.focus()
          editInput.setSelectionRange(
            editInput.value.length,
            editInput.value.length
          )
        })

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

        actions.append(editButton, deleteButton)
        itemHeader.append(actions)
      }

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
