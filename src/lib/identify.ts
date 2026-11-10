import type { MobileNet } from '@tensorflow-models/mobilenet'
import type { ObjectDetection } from '@tensorflow-models/coco-ssd'
import type { Label } from './types'

let modelPromise: Promise<MobileNet> | null = null
let detectorPromise: Promise<ObjectDetection> | null = null

async function loadDetector(): Promise<ObjectDetection> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const tf = await import('@tensorflow/tfjs')
      await tf.ready()
      const cocoSsd = await import('@tensorflow-models/coco-ssd')
      return cocoSsd.load({ base: 'lite_mobilenet_v2' })
    })()
    detectorPromise.catch(() => { detectorPromise = null })
  }
  return detectorPromise
}

async function classifyImage(image: HTMLImageElement): Promise<Label[]> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs')
      await tf.ready()
      const mobilenet = await import('@tensorflow-models/mobilenet')
      return mobilenet.load({ version: 2, alpha: 1.0 })
    })()
    modelPromise.catch(() => { modelPromise = null })
  }
  const model = await modelPromise
  const predictions = await model.classify(image, 5)
  return predictions.map(p => ({ label: p.className.split(',')[0].trim(), probability: p.probability }))
}

export async function identifyImage(image: HTMLImageElement): Promise<Label[]> {
  const [detectionResult, classificationResult] = await Promise.allSettled([
    loadDetector().then(model => model.detect(image, 20, 0.15)),
    classifyImage(image),
  ])
  const candidates = new Map<string, Label>()

  if (detectionResult.status === 'fulfilled') {
    for (const detection of detectionResult.value) {
      const label = detection.class.toLowerCase()
      const current = candidates.get(label)
      if (!current || detection.score > current.probability) {
        candidates.set(label, { label, probability: detection.score })
      }
    }
  } else {
    console.error('Object detection failed.', detectionResult.reason)
  }

  if (classificationResult.status === 'fulfilled') {
    for (const prediction of classificationResult.value) {
      const label = prediction.label.toLowerCase()
      const current = candidates.get(label)
      if (!current || prediction.probability > current.probability) {
        candidates.set(label, { label, probability: prediction.probability })
      }
    }
  } else {
    console.error('Image classification failed.', classificationResult.reason)
  }

  if (detectionResult.status === 'rejected' && classificationResult.status === 'rejected') {
    throw new Error('Could not identify objects in this image.')
  }

  return [...candidates.values()].sort((a, b) => b.probability - a.probability).slice(0, 5)
}
