const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
require("dotenv").config();

admin.initializeApp();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

exports.detectTefillinPhoto = functions.https.onCall(async (data, context) => {
  // Check authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be logged in"
    );
  }

  const uid = context.auth.uid;
  const imageData = data.imageBase64; // Base64 encoded image

  if (!imageData) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Image data is required"
    );
  }

  try {
    // Call Claude Vision API to detect tefillin photo
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageData,
              },
            },
            {
              type: "text",
              text: `Analyze this image and determine if it shows a person laying tefillin (Jewish prayer phylacteries). Tefillin are small black boxes with leather straps worn on the arm and forehead during prayer.

Respond with ONLY one of these:
- "YES" if this is clearly a photo of someone laying or wearing tefillin
- "NO" if this is not a tefillin photo
- "UNCLEAR" if the image is too blurry or unclear to determine

No explanation needed, just the word.`,
            },
          ],
        },
      ],
    });

    const response = message.content[0].text.trim().toUpperCase();
    const isTefillinPhoto = response === "YES";

    // If valid photo, add 30 points to user's coins
    if (isTefillinPhoto) {
      const today = new Date().toISOString().split("T")[0];
      const photosKey = `tefillinPhotos.${today}`;

      // Check if already uploaded today
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(uid)
        .get();

      if (
        userDoc.exists &&
        userDoc.data().tefillinPhotos &&
        userDoc.data().tefillinPhotos[today]
      ) {
        throw new functions.https.HttpsError(
          "already-exists",
          "You already uploaded a tefillin photo today"
        );
      }

      // Add 30 coins
      await admin
        .firestore()
        .collection("users")
        .doc(uid)
        .update({
          coins: admin.firestore.FieldValue.increment(30),
          [photosKey]: new Date().toISOString(),
        });

      return {
        success: true,
        message: "✅ תמונה אומתה! +30 נקודות",
        pointsAdded: 30,
      };
    } else if (response === "UNCLEAR") {
      return {
        success: false,
        message: "❌ התמונה לא ברורה מספיק. בדוק שהתמונה ברורה ונראית כלי הנחת תפילין",
      };
    } else {
      return {
        success: false,
        message: "❌ זו לא תמונה של הנחת תפילין. בחר תמונה חדשה",
      };
    }
  } catch (error) {
    console.error("Error:", error);
    throw new functions.https.HttpsError("internal", "Error processing image");
  }
});
